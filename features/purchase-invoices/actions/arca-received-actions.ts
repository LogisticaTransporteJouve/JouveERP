"use server";

import { z } from "zod";

import { isIvaCondition } from "@/features/clients/schema";
import { logAudit } from "@/lib/actions/audit";
import { createWithClaim } from "@/lib/actions/claim";
import { parseReceivedExport } from "@/lib/afip/mis-comprobantes/parse";
import { ingestReceivedVouchers } from "@/lib/afip/received-vouchers";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/format";
import { logger } from "@/lib/logger";
import { latestTributeSplits } from "@/lib/purchases/tribute-split";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";
import { MAX_UPLOAD_TABLE_BYTES } from "@/lib/tables/limits";

import {
  arcaGapTargetLabel,
  placeReceivedGap,
  receivedVoucherAmounts,
  receivedVoucherGap,
  receivedVoucherItems,
} from "../lib/arca-received-draft";
import {
  ARCA_GAP_TARGETS,
  PURCHASE_IVA_RATE_IDS,
  PURCHASE_TRIBUTE_FIELDS,
  PurchaseInvoiceCreateSchema,
  RECEIVED_VOUCHER_STATUSES,
  ReceivedVoucherDiscardSchema,
  ReceivedVoucherIdSchema,
  ReceivedVoucherListSchema,
  isPurchaseInvoiceStatus,
  type ArcaGapTarget,
  type ReceivedVoucher,
  type ReceivedVoucherStatus,
} from "../schema";
import { createPurchaseInvoiceAction } from "./purchase-invoices-actions";

const DENIED = "No tenés permiso para cargar facturas de compra.";
const ALREADY_PROCESSED = "Este comprobante ya fue procesado.";
const BEING_LOADED = "Otra persona lo está cargando; probá en unos minutos.";
const PAGE_SIZE = 50;
/** A claim older than this with no purchase was left by a crashed save. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

const VOUCHER_COLS =
  "id, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha, cae, moneda, cotizacion, imp_neto_gravado, imp_no_gravado, imp_op_exentas, imp_iva, imp_trib, imp_total, trib_breakdown, iva_breakdown, status, discard_reason, purchase_invoice_id, purchase_invoices(status, invoicing_channels(is_fiscal))";

const money = z.number();
const RowSchema = z.object({
  id: z.string(),
  issuer_cuit: z.string(),
  issuer_name: z.string(),
  cbte_tipo: z.number(),
  kind: z.enum(["factura", "nc", "nd"]).nullable(),
  letter: z.enum(["A", "B", "C"]).nullable(),
  punto_venta: z.number(),
  numero: z.number(),
  fecha: z.string(),
  cae: z.string().nullable(),
  moneda: z.enum(["PES", "DOL"]),
  cotizacion: z.number().nullable(),
  imp_neto_gravado: money,
  imp_no_gravado: money,
  imp_op_exentas: money,
  imp_iva: money,
  imp_trib: money,
  imp_total: money,
  trib_breakdown: z
    .object({
      perc_iva: money.optional(),
      perc_nacionales: money.optional(),
      perc_iibb: money.optional(),
      municipales: money.optional(),
      internos: money.optional(),
    })
    .catch({}),
  iva_breakdown: z
    .array(
      z.object({
        iva_rate_id: z.literal(PURCHASE_IVA_RATE_IDS),
        neto: money,
        iva: money,
      }),
    )
    .catch([]),
  status: z.enum(RECEIVED_VOUCHER_STATUSES),
  discard_reason: z.string().nullable(),
  purchase_invoice_id: z.string().nullable(),
  purchase_invoices: z
    .object({
      status: z.string(),
      invoicing_channels: z.object({ is_fiscal: z.boolean() }).nullable(),
    })
    .nullable(),
});
type Row = z.infer<typeof RowSchema>;

type SupplierById = Map<string, NonNullable<ReceivedVoucher["supplier"]>>;

function toVoucher(row: Row, suppliers: SupplierById): ReceivedVoucher {
  const p = row.purchase_invoices;
  return {
    id: row.id,
    issuer_cuit: row.issuer_cuit,
    issuer_name: row.issuer_name,
    cbte_tipo: row.cbte_tipo,
    kind: row.kind,
    letter: row.letter,
    punto_venta: row.punto_venta,
    numero: row.numero,
    fecha: row.fecha,
    cae: row.cae,
    moneda: row.moneda,
    cotizacion: row.cotizacion,
    imp_neto_gravado: row.imp_neto_gravado,
    imp_no_gravado: row.imp_no_gravado,
    imp_op_exentas: row.imp_op_exentas,
    imp_iva: row.imp_iva,
    imp_trib: row.imp_trib,
    imp_total: row.imp_total,
    trib_breakdown: row.trib_breakdown,
    iva_breakdown: row.iva_breakdown,
    status: row.status,
    discard_reason: row.discard_reason,
    purchase:
      row.purchase_invoice_id && p && isPurchaseInvoiceStatus(p.status)
        ? {
            id: row.purchase_invoice_id,
            status: p.status,
            is_fiscal: p.invoicing_channels?.is_fiscal ?? false,
          }
        : null,
    supplier: suppliers.get(row.issuer_cuit) ?? null,
  };
}

type Service = ReturnType<typeof getServiceClient>;

/** The fiscal suppliers with these CUITs, by CUIT. */
async function suppliersByCuit(
  supabase: Service,
  cuits: readonly string[],
): Promise<SupplierById | null> {
  const out: SupplierById = new Map();
  if (cuits.length === 0) return out;
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, legal_name, display_name, cuit, iva_condition")
    .in("cuit", [...new Set(cuits)])
    .eq("is_fiscal", true);
  if (error) return null;
  for (const s of data ?? []) {
    const { cuit, iva_condition: iva } = s;
    if (cuit === null || !isIvaCondition(iva)) continue;
    out.set(cuit, { ...s, cuit, iva_condition: iva });
  }
  return out;
}

async function readVoucher(
  supabase: Service,
  voucherId: string,
): Promise<ReceivedVoucher | null | "failed"> {
  const { data, error } = await supabase
    .from("arca_received_vouchers")
    .select(VOUCHER_COLS)
    .eq("id", voucherId)
    .maybeSingle();
  if (error) return "failed";
  if (!data) return null;
  const row = RowSchema.safeParse(data);
  if (!row.success) return "failed";
  const suppliers = await suppliersByCuit(supabase, [row.data.issuer_cuit]);
  if (!suppliers) return "failed";
  return toVoucher(row.data, suppliers);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export type UploadReceivedResult = {
  inserted: number;
  unsupported: number;
  alreadyInTray: number;
  linked: number;
  skipped: number;
};

export async function uploadReceivedExportAction(
  formData: FormData,
): Promise<ActionResult<UploadReceivedResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      error: "Elegí el archivo de Mis Comprobantes → Recibidos.",
    };
  }
  if (file.size > MAX_UPLOAD_TABLE_BYTES) {
    return { ok: false, error: "El archivo supera los 4 MB." };
  }
  const parsed = parseReceivedExport(
    file.name,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (typeof parsed === "string") {
    logger.warn("arca_received.upload.rejected", {
      userId: ctx.userId,
      reason: parsed,
    });
    return { ok: false, error: parsed };
  }

  const counts = await ingestReceivedVouchers(
    getServiceClient(),
    parsed.vouchers,
    { origin: "upload" },
  );
  if (!counts) {
    return {
      ok: false,
      error:
        "No se pudo guardar todo el archivo. Volvé a subirlo: lo que ya entró no se duplica.",
    };
  }
  const skipped = Object.values(parsed.skippedByReason).reduce(
    (a, n) => a + n,
    0,
  );
  const result = { ...counts, skipped };
  await logAudit("purchase_invoice.arca_file_uploaded", ctx.userId, {
    ...result,
    skippedByReason: parsed.skippedByReason,
  });
  logger.info("arca_received.upload.done", { userId: ctx.userId, ...result });
  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type ReceivedVoucherPage = {
  vouchers: ReceivedVoucher[];
  nextCursor: { fecha: string; id: string } | null;
};

export async function listReceivedVouchersAction(
  input: unknown,
): Promise<ActionResult<ReceivedVoucherPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const parsed = ReceivedVoucherListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { status, cursor } = parsed.data;

  const supabase = getServiceClient();
  let query = supabase
    .from("arca_received_vouchers")
    .select(VOUCHER_COLS)
    .eq("status", status)
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (cursor) {
    query = query.or(
      `fecha.lt.${cursor.fecha},and(fecha.eq.${cursor.fecha},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  if (error) {
    logger.error("arca_received.list.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudieron leer los comprobantes." };
  }
  const rows: Row[] = [];
  for (const raw of data ?? []) {
    const row = RowSchema.safeParse(raw);
    if (!row.success) {
      logger.error("arca_received.list.failed", {
        userId: ctx.userId,
        code: "bad_row",
      });
      return { ok: false, error: "No se pudieron leer los comprobantes." };
    }
    rows.push(row.data);
  }
  const page = rows.slice(0, PAGE_SIZE);
  const suppliers = await suppliersByCuit(
    supabase,
    page.map((r) => r.issuer_cuit),
  );
  if (!suppliers) {
    logger.error("arca_received.list.failed", {
      userId: ctx.userId,
      code: "suppliers",
    });
    return { ok: false, error: "No se pudieron leer los comprobantes." };
  }
  // Only for the split suggestion: a failed read suggests without history.
  const supplierIds = page
    .filter((r) => r.imp_trib > 0 && Object.keys(r.trib_breakdown).length === 0)
    .flatMap((r) => suppliers.get(r.issuer_cuit)?.id ?? []);
  const history = await latestTributeSplits(supabase, supplierIds);
  if (!history) {
    logger.warn("arca_received.list.tribute_history_failed", {
      userId: ctx.userId,
    });
  }
  const last = page[page.length - 1];
  return {
    ok: true,
    data: {
      vouchers: page.map((r) => {
        const v = toVoucher(r, suppliers);
        const h = v.supplier ? history?.get(v.supplier.id) : undefined;
        return { ...v, tribute_history: h ?? null };
      }),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? { fecha: last.fecha, id: last.id }
          : null,
    },
  };
}

export async function getReceivedVoucherCountsAction(): Promise<
  ActionResult<{ pending: number }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const { count, error } = await getServiceClient()
    .from("arca_received_vouchers")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review");
  if (error) {
    logger.error("arca_received.counts.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo contar los pendientes." };
  }
  return { ok: true, data: { pending: count ?? 0 } };
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;

function arcaGapChoiceMessage(gap: number, voucher: ReceivedVoucher): string {
  const amount = formatMoney(gap, voucher.moneda === "DOL" ? "USD" : "ARS");
  const choices = ARCA_GAP_TARGETS.map((t) =>
    arcaGapTargetLabel(t, voucher.letter).toLowerCase(),
  ).join(" o ");
  return `Los importes de ARCA no suman el total: elegí a dónde va la diferencia de ${amount} (${choices}).`;
}

const GapTargetSchema = z.enum(ARCA_GAP_TARGETS).nullable().default(null);

/** Why the purchase sent does not match the voucher, or null when it does.
 *  Only the sum of the four tributes is checked: the split is the user's.
 *  The gap is the voucher's, recomputed here: only where it goes comes from
 *  the person. */
async function mismatch(
  supabase: Service,
  voucher: ReceivedVoucher,
  invoice: z.infer<typeof PurchaseInvoiceCreateSchema>,
  gapTarget: ArcaGapTarget | null,
): Promise<string | null> {
  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("cuit")
    .eq("id", invoice.supplier_id)
    .maybeSingle();
  if (error) return "No se pudo leer el proveedor.";
  if (supplier?.cuit !== voucher.issuer_cuit) {
    return `El proveedor tiene que ser el de CUIT ${voucher.issuer_cuit}.`;
  }
  if (
    invoice.kind !== voucher.kind ||
    (invoice.letter ?? null) !== voucher.letter ||
    invoice.punto_venta !== voucher.punto_venta ||
    invoice.numero !== voucher.numero
  ) {
    return "El tipo, la letra y el número tienen que ser los de ARCA.";
  }
  if (
    invoice.fecha !== voucher.fecha ||
    invoice.moneda !== voucher.moneda ||
    (voucher.cae !== null && (invoice.cae_proveedor ?? null) !== voucher.cae)
  ) {
    return "La fecha, la moneda y el CAE tienen que ser los de ARCA.";
  }
  const { data: channel, error: channelError } = await supabase
    .from("invoicing_channels")
    .select("is_fiscal")
    .eq("id", invoice.channel_id)
    .maybeSingle();
  if (channelError) return "No se pudo leer el canal.";
  if (!channel?.is_fiscal)
    return "Un comprobante de ARCA va a un canal fiscal.";

  const gap = receivedVoucherGap(voucher);
  if (gap !== null && gapTarget === null) {
    return arcaGapChoiceMessage(gap, voucher);
  }
  const arca = receivedVoucherAmounts(voucher);
  const want =
    gap !== null && gapTarget !== null
      ? placeReceivedGap(arca, voucher.letter, gap, gapTarget)
      : arca;
  const tributes = PURCHASE_TRIBUTE_FIELDS.reduce((a, f) => a + invoice[f], 0);
  const same =
    near(invoice.imp_neto, want.imp_neto) &&
    near(invoice.imp_no_gravado, want.imp_no_gravado) &&
    near(invoice.imp_op_exentas, want.imp_op_exentas) &&
    near(invoice.imp_iva, want.imp_iva) &&
    near(invoice.imp_trib, want.imp_trib) &&
    near(tributes, want.imp_trib) &&
    near(invoice.imp_total, want.imp_total);
  return same ? null : "Los importes tienen que ser los de ARCA.";
}

export async function createPurchaseInvoiceFromReceivedAction(input: {
  voucherId: unknown;
  invoice: unknown;
  /** Where ARCA's total above its parts goes; only that, never the amount. */
  gapTarget?: unknown;
}): Promise<ActionResult<{ id: string; linkedExisting: boolean }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const id = ReceivedVoucherIdSchema.safeParse({ voucherId: input.voucherId });
  const gapTarget = GapTargetSchema.safeParse(input.gapTarget);
  const invoice = PurchaseInvoiceCreateSchema.safeParse(input.invoice);
  if (!id.success || !gapTarget.success) {
    return { ok: false, error: "Datos inválidos." };
  }
  if (!invoice.success) {
    return {
      ok: false,
      error: invoice.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const voucherId = id.data.voucherId;
  const supabase = getServiceClient();
  const fail = (code: string) => {
    logger.error("arca_received.accept.failed", {
      userId: ctx.userId,
      voucherId,
      code,
    });
    return { ok: false as const, error: "No se pudo cargar el comprobante." };
  };

  const voucher = await readVoucher(supabase, voucherId);
  if (voucher === "failed") return fail("read");
  // A retry after a save whose answer was lost: it is already loaded.
  if (voucher?.status === "confirmed" && voucher.purchase) {
    return {
      ok: true,
      data: { id: voucher.purchase.id, linkedExisting: true },
    };
  }
  if (!voucher || voucher.status !== "pending_review") {
    return { ok: false, error: ALREADY_PROCESSED };
  }
  const wrong = await mismatch(supabase, voucher, invoice.data, gapTarget.data);
  if (wrong) return { ok: false, error: wrong };

  // Loaded by hand meanwhile: link it instead of creating a second one.
  const { error: linkError } = await supabase.rpc("link_received_vouchers", {
    p_ids: [voucherId],
  });
  if (linkError) return fail(linkError.code);
  const relinked = await readVoucher(supabase, voucherId);
  if (relinked === "failed") return fail("reread");
  if (relinked?.status === "confirmed" && relinked.purchase) {
    await logAudit(
      "purchase_invoice.arca_voucher_confirmed",
      ctx.userId,
      {
        voucherId,
        purchaseInvoiceId: relinked.purchase.id,
        linkedExisting: true,
      },
      relinked.purchase.id,
    );
    return {
      ok: true,
      data: { id: relinked.purchase.id, linkedExisting: true },
    };
  }

  // Not linked above, so a fiscal purchase with this key (same letter, or an
  // old one without letter) is cancelled or has another total: creating a
  // second one would hide that.
  const { data: sameKey, error: sameKeyError } = await supabase
    .from("purchase_invoices")
    .select(
      "status, imp_total, suppliers!inner(cuit), invoicing_channels!inner(is_fiscal)",
    )
    .eq("suppliers.cuit", voucher.issuer_cuit)
    .eq("invoicing_channels.is_fiscal", true)
    .eq("kind", invoice.data.kind)
    .eq("punto_venta", voucher.punto_venta)
    .eq("numero", voucher.numero)
    .or(
      voucher.letter
        ? `letter.eq.${voucher.letter},letter.is.null`
        : "letter.is.null",
    )
    .limit(1);
  if (sameKeyError) return fail(sameKeyError.code);
  const existing = sameKey?.[0];
  if (existing?.status === "cancelled") {
    return { ok: false, error: "Ya existe esta factura anulada en Compras." };
  }
  if (existing) {
    return {
      ok: false,
      error: `Ya hay una compra con este número y otro total (${formatMoney(existing.imp_total)}): revisala antes de aceptar.`,
    };
  }

  const items = receivedVoucherItems(voucher);
  const created = await createWithClaim({
    claim: async () => {
      const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
      const { data, error } = await supabase
        .from("arca_received_vouchers")
        .update({
          claimed_at: new Date().toISOString(),
          reviewed_by: ctx.userId,
        })
        .eq("id", voucherId)
        .eq("status", "pending_review")
        .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
        .select("id")
        .maybeSingle();
      if (error) {
        fail(error.code);
        return "failed";
      }
      return data !== null ? "won" : "lost";
    },
    release: async () => {
      const { error } = await supabase
        .from("arca_received_vouchers")
        .update({ claimed_at: null, reviewed_by: null })
        .eq("id", voucherId)
        .is("purchase_invoice_id", null);
      if (error) fail(error.code);
    },
    // The lines are ARCA's (or none): client lines would recompute the
    // amounts just checked.
    create: () => createPurchaseInvoiceAction({ ...invoice.data, items }),
    alreadyProcessed: BEING_LOADED,
    claimFailed: "No se pudo cargar el comprobante.",
  });
  // A partial failure (createdId) still made the purchase: the
  // purchase_invoices_link_received trigger linked the voucher to it.
  if (!created.ok) return { ok: false, error: created.error };

  const { error: confirmError } = await supabase
    .from("arca_received_vouchers")
    .update({
      status: "confirmed",
      purchase_invoice_id: created.data.id,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
      claimed_at: null,
    })
    .eq("id", voucherId)
    .or(
      `status.eq.pending_review,and(status.eq.confirmed,purchase_invoice_id.eq.${created.data.id})`,
    );
  // The trigger linked it already; this only stamps who reviewed it.
  if (confirmError) fail(confirmError.code);

  await logAudit(
    "purchase_invoice.arca_voucher_confirmed",
    ctx.userId,
    { voucherId, purchaseInvoiceId: created.data.id, linkedExisting: false },
    created.data.id,
  );
  return { ok: true, data: { id: created.data.id, linkedExisting: false } };
}

// ---------------------------------------------------------------------------
// Discard / restore
// ---------------------------------------------------------------------------

async function moveVoucher(
  input: unknown,
  op: "discard" | "restore",
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const parsed =
    op === "discard"
      ? ReceivedVoucherDiscardSchema.safeParse(input)
      : ReceivedVoucherIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { voucherId } = parsed.data;
  const reason =
    "reason" in parsed.data && typeof parsed.data.reason === "string"
      ? parsed.data.reason
      : null;
  const from: ReceivedVoucherStatus =
    op === "discard" ? "pending_review" : "discarded";
  const supabase = getServiceClient();
  let query = supabase
    .from("arca_received_vouchers")
    .update(
      op === "discard"
        ? {
            status: "discarded",
            discard_reason: reason,
            reviewed_by: ctx.userId,
            reviewed_at: new Date().toISOString(),
          }
        : {
            status: "pending_review",
            discard_reason: null,
            reviewed_by: null,
            reviewed_at: null,
          },
    )
    .eq("id", voucherId)
    .eq("status", from)
    .is("purchase_invoice_id", null);
  // Someone accepting it right now holds a fresh claim.
  if (op === "discard") {
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    query = query.or(`claimed_at.is.null,claimed_at.lt.${cutoff}`);
  }
  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    logger.error(
      op === "discard"
        ? "arca_received.discard.failed"
        : "arca_received.restore.failed",
      { userId: ctx.userId, voucherId, code: error.code },
    );
    return { ok: false, error: "No se pudo actualizar el comprobante." };
  }
  if (!data) {
    const current = await readVoucher(supabase, voucherId);
    return {
      ok: false,
      error:
        op === "discard" &&
        current !== "failed" &&
        current?.status === "pending_review"
          ? BEING_LOADED
          : ALREADY_PROCESSED,
    };
  }
  await logAudit(
    op === "discard"
      ? "purchase_invoice.arca_voucher_discarded"
      : "purchase_invoice.arca_voucher_restored",
    ctx.userId,
    op === "discard"
      ? { voucherId, hasReason: reason !== null }
      : { voucherId },
  );
  return { ok: true, data: undefined };
}

export async function discardReceivedVoucherAction(
  input: unknown,
): Promise<ActionResult> {
  return moveVoucher(input, "discard");
}

export async function restoreReceivedVoucherAction(
  input: unknown,
): Promise<ActionResult> {
  return moveVoucher(input, "restore");
}
