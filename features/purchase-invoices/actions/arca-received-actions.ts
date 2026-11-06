"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { parseReceivedExport } from "@/lib/afip/mis-comprobantes/parse";
import {
  ingestReceivedVouchers,
  ingestUnreadableVouchers,
} from "@/lib/afip/received-vouchers";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  ALREADY_PROCESSED,
  BEING_LOADED,
  STALE_CLAIM_MS,
  acceptReceivedVoucher,
} from "@/lib/commands/accept-received-voucher";
import { logger } from "@/lib/logger";
import { latestTributeSplits } from "@/lib/purchases/tribute-split";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";
import { MAX_UPLOAD_TABLE_BYTES } from "@/lib/tables/limits";

import {
  RowSchema,
  readVoucher,
  suppliersByCuit,
  toVoucher,
  VOUCHER_COLS,
  type Row,
} from "../lib/received-voucher-read";
import {
  ARCA_GAP_TARGETS,
  PurchaseInvoiceCreateSchema,
  ReceivedVoucherDiscardSchema,
  ReceivedVoucherIdSchema,
  ReceivedVoucherListSchema,
  type ReceivedVoucher,
  type ReceivedVoucherStatus,
} from "../schema";

const DENIED = "No tenés permiso para cargar facturas de compra.";
const EMPLOYEE_CHARGE_DENIED =
  "No tenés permiso para cargar una compra a un empleado.";
const PAGE_SIZE = 50;

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

  const supabase = getServiceClient();
  const counts = await ingestReceivedVouchers(supabase, parsed.vouchers, {
    origin: "upload",
  });
  // The rows that did not read stay in the tray to be loaded by hand.
  const kept =
    counts &&
    (await ingestUnreadableVouchers(supabase, parsed.unreadable, {
      origin: "upload",
    }));
  if (!counts || kept === null) {
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
  ActionResult<{ pending: number; unreadable: number }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const supabase = getServiceClient();
  const count = (status: ReceivedVoucherStatus) =>
    supabase
      .from("arca_received_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
  const [pending, unreadable] = await Promise.all([
    count("pending_review"),
    count("unreadable"),
  ]);
  const error = pending.error ?? unreadable.error;
  if (error) {
    logger.error("arca_received.counts.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo contar los pendientes." };
  }
  return {
    ok: true,
    data: { pending: pending.count ?? 0, unreadable: unreadable.count ?? 0 },
  };
}

/** One tray voucher, with its supplier's latest tribute split when ARCA gives
 *  only the total of otros tributos (the accept dialog's suggestion), or null
 *  when there is no such voucher. */
export async function getReceivedVoucherAction(
  input: unknown,
): Promise<ActionResult<ReceivedVoucher | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const parsed = ReceivedVoucherIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const supabase = getServiceClient();
  const voucher = await readVoucher(supabase, parsed.data.voucherId);
  if (voucher === "failed") {
    logger.error("arca_received.get.failed", {
      userId: ctx.userId,
      voucherId: parsed.data.voucherId,
    });
    return { ok: false, error: "No se pudo leer el comprobante." };
  }
  if (!voucher) return { ok: true, data: null };
  const needsHistory =
    voucher.supplier !== null &&
    voucher.imp_trib > 0 &&
    Object.keys(voucher.trib_breakdown).length === 0;
  // Only for the split suggestion: a failed read suggests without history.
  const history =
    needsHistory && voucher.supplier
      ? await latestTributeSplits(supabase, [voucher.supplier.id])
      : null;
  return {
    ok: true,
    data: {
      ...voucher,
      tribute_history:
        (voucher.supplier && history?.get(voucher.supplier.id)) ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

const GapTargetSchema = z.enum(ARCA_GAP_TARGETS).nullable().default(null);

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
  if (invoice.data.charged_employee_id && !userCan(ctx.access, "hr:write")) {
    return { ok: false, error: EMPLOYEE_CHARGE_DENIED };
  }
  return acceptReceivedVoucher(ctx.userId, {
    voucherId: id.data.voucherId,
    invoice: invoice.data,
    gapTarget: gapTarget.data,
  });
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
  const supabase = getServiceClient();
  // A voucher whose amounts did not read, or whose type does not load by
  // itself, goes back to its own tab.
  let restoreTo: ReceivedVoucherStatus = "pending_review";
  if (op === "restore") {
    const current = await readVoucher(supabase, voucherId);
    if (current === "failed") {
      logger.error("arca_received.restore.failed", {
        userId: ctx.userId,
        voucherId,
        code: "read",
      });
      return { ok: false, error: "No se pudo actualizar el comprobante." };
    }
    if (current?.kind === null) restoreTo = "unsupported";
    else if (current?.unreadable_reason) restoreTo = "unreadable";
  }
  const from: ReceivedVoucherStatus[] =
    op === "discard"
      ? ["pending_review", "unreadable", "unsupported"]
      : ["discarded"];
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
            status: restoreTo,
            discard_reason: null,
            reviewed_by: null,
            reviewed_at: null,
          },
    )
    .eq("id", voucherId)
    .in("status", from)
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
        (current?.status === "pending_review" ||
          current?.status === "unreadable" ||
          current?.status === "unsupported")
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
