import "server-only";

import { NonRetriableError } from "inngest";
import { z } from "zod";

import {
  ARCA_BULK_ACCEPT_PERMISSIONS,
  BULK_OPENING_DATE,
  BULK_PHASES,
  BULK_STALE_RUN_MS,
  BulkProgressSchema,
  bulkAcceptOrder,
  emptyBulkProgress,
  missingSuppliers,
  pickBulkChannel,
  pickBulkCotizacion,
  pickOriginByTotal,
  supplierFromPadron,
  type BulkDelta,
  type BulkPendingReason,
  type BulkPhase,
  type BulkProgress,
  type BulkRun,
  type MissingSupplier,
  type OriginCandidate,
  type PadronAnswer,
} from "@/features/purchase-invoices/lib/arca-bulk-accept";
import { arcaVoucherToDraft } from "@/features/purchase-invoices/lib/arca-received-draft";
import {
  arcaDraftAmounts,
  arcaReceivedInvoice,
  fullTributeSplit,
  supplierDueDate,
  tributeSplitTotal,
} from "@/features/purchase-invoices/lib/arca-received-invoice";
import {
  RowSchema,
  suppliersByCuit,
  toVoucher,
  VOUCHER_COLS,
  type Row,
} from "@/features/purchase-invoices/lib/received-voucher-read";
import { supplierCostDefaults } from "@/features/purchase-invoices/lib/supplier-defaults";
import {
  PURCHASE_INVOICE_LETTERS,
  PurchaseInvoiceCreateSchema,
  formatInvoiceNumber,
  type ReceivedVoucher,
} from "@/features/purchase-invoices/schema";
import { SupplierCreateSchema } from "@/features/suppliers/schema";
import { IVA_CONDITIONS } from "@/features/clients/schema";
import { logAudit } from "@/lib/actions/audit";
import { consultarPadron, PadronNoConstanciaError } from "@/lib/afip/padron";
import {
  HeadlessTokenRejectedError,
  resolveHeadlessUser,
  runAsHeadlessUser,
} from "@/lib/auth/headless-user";
import { userCanAll } from "@/lib/auth/permissions";
import { acceptReceivedVoucher } from "@/lib/commands/accept-received-voucher";
import {
  createSupplier,
  DUPLICATE_SUPPLIER_CUIT,
} from "@/lib/commands/create-supplier";
import type { Json } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { fetchUsdRateOnOrBefore } from "@/lib/fx";
import { logger } from "@/lib/logger";
import { latestTributeSplits } from "@/lib/purchases/tribute-split";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

// «Aceptar todos los pendientes» (Compras › Recibidos de ARCA), step by step:
// the Inngest function (lib/inngest/functions/arca-bulk-accept.ts) calls
// these in chunks. Every write runs as the owner who asked, through the same
// commands the tray and the supplier form use; reads go through the service
// client after that owner's gate. One voucher that fails stays pending and
// the batch goes on.

type Service = ReturnType<typeof getServiceClient>;

const PAGE = 1000;
const PADRON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ORIGIN_CANDIDATES = 100;

// ─── Run bookkeeping ─────────────────────────────────────────────────────────

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value));
}

/** The latest run, or null when there was none; throws on a failed read. */
export async function readLatestBulkRun(
  service: Service,
): Promise<BulkRun | null> {
  const { data, error } = await service
    .from("arca_bulk_accept_runs")
    .select("id, phase, requested_at, started_at, finished_at, progress, error")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`bulk run read: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    phase: z.enum(BULK_PHASES).catch("failed").parse(data.phase),
    requestedAt: data.requested_at,
    startedAt: data.started_at,
    finishedAt: data.finished_at,
    progress: BulkProgressSchema.parse(data.progress ?? {}),
    error: data.error,
  };
}

/** Closes a run left open longer than a run can last (it died without its
 *  failure handler), so it no longer blocks a new one. */
export async function closeStaleBulkRuns(
  service: Service,
  now = Date.now(),
): Promise<void> {
  const { error } = await service
    .from("arca_bulk_accept_runs")
    .update({
      finished_at: new Date(now).toISOString(),
      phase: "failed",
      error: "La corrida se cortó sin terminar.",
    })
    .is("finished_at", null)
    .lt("requested_at", new Date(now - BULK_STALE_RUN_MS).toISOString());
  if (error) throw new Error(`bulk run stale close: ${error.message}`);
}

export async function saveBulkProgress(
  service: Service,
  runId: string,
  phase: BulkPhase,
  progress: BulkProgress,
): Promise<void> {
  const { error } = await service
    .from("arca_bulk_accept_runs")
    .update({ phase, progress: toJson(progress) })
    .eq("id", runId)
    .is("finished_at", null);
  if (error) throw new Error(`bulk run progress: ${error.message}`);
}

export async function startBulkRun(
  service: Service,
  runId: string,
  progress: BulkProgress,
): Promise<void> {
  const { error } = await service
    .from("arca_bulk_accept_runs")
    .update({
      started_at: new Date().toISOString(),
      phase: "suppliers",
      progress: toJson(progress),
    })
    .eq("id", runId)
    .is("finished_at", null);
  if (error) throw new Error(`bulk run start: ${error.message}`);
}

export async function finishBulkRun(
  service: Service,
  runId: string,
  progress: BulkProgress,
): Promise<void> {
  const { error } = await service
    .from("arca_bulk_accept_runs")
    .update({
      finished_at: new Date().toISOString(),
      phase: "done",
      progress: toJson(progress),
    })
    .eq("id", runId);
  if (error) throw new Error(`bulk run finish: ${error.message}`);
}

export async function failBulkRun(
  service: Service,
  runId: string,
  message: string,
): Promise<void> {
  const { error } = await service
    .from("arca_bulk_accept_runs")
    .update({
      finished_at: new Date().toISOString(),
      phase: "failed",
      error: message.slice(0, 500),
    })
    .eq("id", runId)
    .is("finished_at", null);
  if (error) {
    logger.error("arca_bulk_accept.fail_mark_failed", {
      runId,
      code: error.code,
    });
  }
}

// ─── As the owner ────────────────────────────────────────────────────────────

/**
 * Runs `fn` as the owner who asked, re-checking their access now (a token
 * lasts 15 minutes: one per step). An owner no longer allowed, or a server
 * that cannot act as them, stops the run without retries.
 */
export async function asBulkOwner<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const resolved = await resolveHeadlessUser(userId, "opening_balances:write");
  if (!resolved.ok) {
    throw new NonRetriableError(
      resolved.reason === "headless_unavailable"
        ? "El servidor no puede actuar como el usuario que lo pidió."
        : "El usuario que lo pidió ya no puede hacerlo.",
    );
  }
  if (!userCanAll(resolved.user.access, ARCA_BULK_ACCEPT_PERMISSIONS)) {
    throw new NonRetriableError("El usuario que lo pidió ya no puede hacerlo.");
  }
  try {
    return await runAsHeadlessUser(resolved.user, fn);
  } catch (err) {
    if (err instanceof HeadlessTokenRejectedError) {
      throw new NonRetriableError(
        "El servidor no puede actuar como el usuario que lo pidió.",
      );
    }
    throw err;
  }
}

// ─── What to do ──────────────────────────────────────────────────────────────

const ListRowSchema = z.object({
  id: z.string(),
  issuer_cuit: z.string(),
  issuer_name: z.string(),
  kind: z.enum(["factura", "nc", "nd"]).nullable(),
  letter: z.enum(PURCHASE_INVOICE_LETTERS).nullable(),
  fecha: z.string(),
  punto_venta: z.number(),
  numero: z.number(),
});

export type BulkWork = { missing: MissingSupplier[]; voucherIds: string[] };

/** Every pending voucher in load order, and the CUITs among them with no
 *  fiscal supplier yet. */
export async function listBulkWork(service: Service): Promise<BulkWork> {
  const rows: z.infer<typeof ListRowSchema>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from("arca_received_vouchers")
      .select(
        "id, issuer_cuit, issuer_name, kind, letter, fecha, punto_venta, numero",
      )
      .eq("status", "pending_review")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`bulk list vouchers: ${error.message}`);
    for (const raw of data ?? []) rows.push(ListRowSchema.parse(raw));
    if ((data ?? []).length < PAGE) break;
  }

  const known = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from("suppliers")
      .select("cuit")
      .eq("is_fiscal", true)
      .not("cuit", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`bulk list suppliers: ${error.message}`);
    for (const s of data ?? []) if (s.cuit) known.add(s.cuit);
    if ((data ?? []).length < PAGE) break;
  }

  return {
    missing: missingSuppliers(rows, known),
    voucherIds: bulkAcceptOrder(rows).map((r) => r.id),
  };
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

const CachedContributorSchema = z.object({
  legal_name: z.string(),
  tax_condition: z.enum(IVA_CONDITIONS),
  fiscal_address: z
    .object({
      street: z.string(),
      city: z.string(),
      province: z.string(),
      postal_code: z.string(),
    })
    .nullable(),
});

/** Padrón for a CUIT: a fresh cache entry, else AFIP (cached on success).
 *  A failure (no constancia, AFIP down) is an answer, never a throw. */
async function lookupPadron(
  service: Service,
  cuit: string,
): Promise<PadronAnswer> {
  const { data: cached } = await service
    .from("padron_cache")
    .select("data, cached_at")
    .eq("cuit", cuit)
    .maybeSingle();
  if (
    cached &&
    Date.now() - new Date(cached.cached_at).getTime() < PADRON_CACHE_TTL_MS
  ) {
    const parsed = CachedContributorSchema.safeParse(cached.data);
    if (parsed.success) return { kind: "found", info: parsed.data };
  }
  try {
    const info = await consultarPadron(cuit);
    const { error } = await service
      .from("padron_cache")
      .upsert(
        { cuit, data: toJson(info), cached_at: new Date().toISOString() },
        { onConflict: "cuit" },
      );
    if (error) {
      logger.warn("padron_cache.write_failed", { cuit, err: error.message });
    }
    return { kind: "found", info };
  } catch (err) {
    logger.warn("arca_bulk_accept.padron_failed", {
      cuit,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      kind: "failed",
      legalName: err instanceof PadronNoConstanciaError ? err.legalName : null,
    };
  }
}

/** Creates each missing supplier as the owner (inside asBulkOwner). One
 *  already created meanwhile counts as existing. */
export async function createMissingSuppliers(
  userId: string,
  missing: readonly MissingSupplier[],
): Promise<BulkDelta> {
  const service = getServiceClient();
  const counts = {
    created: 0,
    existing: 0,
    fromPadron: 0,
    fallback: 0,
    failed: 0,
  };
  const errors: NonNullable<BulkDelta["errors"]> = [];
  const fail = (cuit: string, message: string) => {
    counts.failed++;
    errors.push({ scope: "supplier", ref: `CUIT ${cuit}`, message });
  };
  for (const m of missing) {
    try {
      const { input, fromPadron } = supplierFromPadron(
        m,
        await lookupPadron(service, m.cuit),
      );
      const parsed = SupplierCreateSchema.safeParse(input);
      if (!parsed.success) {
        fail(m.cuit, parsed.error.issues[0]?.message ?? "Datos inválidos.");
        continue;
      }
      const res = await createSupplier(userId, parsed.data);
      if (res.ok) {
        counts.created++;
        if (fromPadron) counts.fromPadron++;
        else counts.fallback++;
      } else if (res.error === DUPLICATE_SUPPLIER_CUIT) {
        counts.existing++;
      } else {
        fail(m.cuit, res.error);
      }
    } catch (err) {
      logger.error("arca_bulk_accept.supplier_failed", {
        userId,
        cuit: m.cuit,
        error: err instanceof Error ? err.message : String(err),
      });
      fail(m.cuit, "No se pudo crear el proveedor.");
    }
  }
  return { suppliers: counts, errors };
}

// ─── Vouchers ────────────────────────────────────────────────────────────────

type SupplierDefaults = {
  id: string;
  default_channel_id: string | null;
  default_payment_term_days: number | null;
  default_expense_account_id: string | null;
  default_cost_center_id: string | null;
};

type ChunkContext = {
  service: Service;
  suppliers: Map<string, SupplierDefaults>;
  channels: {
    id: string;
    is_fiscal: boolean;
    is_active: boolean;
    is_segregated: boolean;
  }[];
  costOptions: Parameters<typeof supplierCostDefaults>[1];
  rates: Map<string, Awaited<ReturnType<typeof fetchUsdRateOnOrBefore>>>;
};

export type VoucherChunkResult = {
  delta: BulkDelta;
  /** Suppliers with a purchase loaded (or found loaded) dated up to the
   *  opening date: the ones whose opening balance is set. */
  affectedSupplierIds: string[];
};

type Outcome =
  | { kind: "accepted"; linked: boolean; supplierId: string }
  | { kind: "already"; supplierId: string | null }
  | { kind: "pending"; reason: BulkPendingReason; message?: string };

async function readChunk(
  service: Service,
  ids: readonly string[],
): Promise<{
  vouchers: Map<string, ReceivedVoucher>;
  /** Rows that did not parse: they stay pending, the rest go on. */
  unreadable: Set<string>;
  ctx: ChunkContext;
}> {
  const { data, error } = await service
    .from("arca_received_vouchers")
    .select(VOUCHER_COLS)
    .in("id", [...ids]);
  if (error) throw new Error(`bulk chunk vouchers: ${error.message}`);
  const rows: Row[] = [];
  const unreadable = new Set<string>();
  for (const raw of data ?? []) {
    const row = RowSchema.safeParse(raw);
    if (row.success) rows.push(row.data);
    else if (typeof raw.id === "string") unreadable.add(raw.id);
  }
  const byCuit = await suppliersByCuit(
    service,
    rows.map((r) => r.issuer_cuit),
  );
  if (!byCuit) throw new Error("bulk chunk suppliers by cuit");
  const supplierIds = [...byCuit.values()].map((s) => s.id);

  const [supplierRows, channels, history] = await Promise.all([
    service
      .from("suppliers")
      .select(
        "id, default_channel_id, default_payment_term_days, default_expense_account_id, default_cost_center_id",
      )
      .in("id", supplierIds),
    service
      .from("invoicing_channels")
      .select("id, is_fiscal, is_active, is_segregated"),
    latestTributeSplits(service, supplierIds),
  ]);
  if (supplierRows.error) {
    throw new Error(
      `bulk chunk supplier defaults: ${supplierRows.error.message}`,
    );
  }
  if (channels.error) {
    throw new Error(`bulk chunk channels: ${channels.error.message}`);
  }
  const suppliers = new Map(
    (supplierRows.data ?? []).map((s) => [s.id, s] as const),
  );

  let costOptions: ChunkContext["costOptions"];
  if (
    [...suppliers.values()].some(
      (s) => s.default_expense_account_id || s.default_cost_center_id,
    )
  ) {
    const [accounts, centers] = await Promise.all([
      service.from("expense_leaf_accounts").select("id, code, name"),
      service.from("cost_centers").select("id, code, name, is_active"),
    ]);
    // Without the options a default's being offered is unknown: none applies,
    // as in the form.
    if (!accounts.error && !centers.error) {
      costOptions = {
        expenseAccounts: (accounts.data ?? []).flatMap((a) =>
          a.id && a.code && a.name
            ? [{ id: a.id, code: a.code, name: a.name }]
            : [],
        ),
        costCenters: (centers.data ?? []).flatMap(({ is_active, ...c }) =>
          is_active ? [c] : [],
        ),
        inactiveCostCenters: [],
      };
    }
  }

  const vouchers = new Map<string, ReceivedVoucher>();
  for (const row of rows) {
    const v = toVoucher(row, byCuit);
    const h = v.supplier ? history?.get(v.supplier.id) : undefined;
    vouchers.set(v.id, { ...v, tribute_history: h ?? null });
  }
  return {
    vouchers,
    unreadable,
    ctx: {
      service,
      suppliers,
      channels: channels.data ?? [],
      costOptions,
      rates: new Map(),
    },
  };
}

/** The supplier's facturas an NC/ND can hang from, with what is open. */
async function originCandidates(
  service: Service,
  supplierId: string,
  v: ReceivedVoucher,
): Promise<OriginCandidate[]> {
  let query = service
    .from("purchase_invoices")
    .select("id, fecha, imp_total, invoicing_channels!inner(is_fiscal)")
    .eq("supplier_id", supplierId)
    .eq("kind", "factura")
    .eq("status", "received")
    .eq("moneda", v.moneda)
    .eq("invoicing_channels.is_fiscal", true)
    .lte("fecha", v.fecha)
    .order("fecha", { ascending: false })
    .limit(ORIGIN_CANDIDATES);
  query = v.letter ? query.eq("letter", v.letter) : query.is("letter", null);
  const { data, error } = await query;
  if (error) throw new Error(`bulk origin candidates: ${error.message}`);
  const facturas = data ?? [];
  if (facturas.length === 0) return [];
  const { data: open, error: openError } = await service
    .from("v_purchase_invoice_open")
    .select("purchase_invoice_id, open_amount")
    .in(
      "purchase_invoice_id",
      facturas.map((f) => f.id),
    );
  if (openError) throw new Error(`bulk origin open: ${openError.message}`);
  const openById = new Map(
    (open ?? []).map((o) => [
      o.purchase_invoice_id,
      Number(o.open_amount ?? 0),
    ]),
  );
  return facturas.map((f) => ({
    id: f.id,
    fecha: f.fecha,
    imp_total: Number(f.imp_total),
    open_amount: openById.get(f.id) ?? Number(f.imp_total),
  }));
}

async function rateFor(ctx: ChunkContext, fecha: string) {
  if (!ctx.rates.has(fecha)) {
    ctx.rates.set(fecha, await fetchUsdRateOnOrBefore(ctx.service, fecha));
  }
  return ctx.rates.get(fecha) ?? null;
}

async function acceptOne(
  userId: string,
  v: ReceivedVoucher,
  ctx: ChunkContext,
): Promise<Outcome> {
  if (v.status === "confirmed") {
    return { kind: "already", supplierId: v.supplier?.id ?? null };
  }
  if (v.status !== "pending_review")
    return { kind: "already", supplierId: null };
  if (v.kind === null) {
    return {
      kind: "pending",
      reason: "error",
      message: "Ese tipo de comprobante no se carga solo.",
    };
  }
  const supplier = v.supplier ? ctx.suppliers.get(v.supplier.id) : undefined;
  if (!supplier) return { kind: "pending", reason: "sin_proveedor" };

  const channelId = pickBulkChannel(ctx.channels, supplier.default_channel_id);
  if (!channelId) return { kind: "pending", reason: "sin_canal" };

  const cotizacion = pickBulkCotizacion(
    v,
    v.moneda === "DOL" && !(v.cotizacion !== null && v.cotizacion > 1)
      ? await rateFor(ctx, v.fecha)
      : null,
  );
  if (cotizacion === null) return { kind: "pending", reason: "sin_cotizacion" };

  // The tray's own draft: ARCA's amounts, its tribute split (or the
  // suggestion when ARCA gives only the total). A gap goes to no gravado (the
  // net on a B or C): no tax effect.
  const base = arcaVoucherToDraft(v);
  const gapTarget = base.arca_gap != null ? "no_gravado" : null;
  const amounts = arcaDraftAmounts(base, v.letter, gapTarget);
  const split = fullTributeSplit(base.tributes ?? {});
  if (Math.abs(tributeSplitTotal(split) - amounts.imp_trib) > 0.01) {
    return { kind: "pending", reason: "tributos_sin_reparto" };
  }

  let originId: string | null = null;
  if (v.kind !== "factura") {
    originId = pickOriginByTotal(
      await originCandidates(ctx.service, supplier.id, v),
      { kind: v.kind, fecha: v.fecha, imp_total: v.imp_total },
    );
    if (!originId) return { kind: "pending", reason: "nc_nd_sin_origen" };
  }

  // A factura takes the supplier's defaults still offered; an NC/ND none, so
  // the trigger copies its origin's.
  const defaults =
    v.kind === "factura" ? supplierCostDefaults(supplier, ctx.costOptions) : [];
  const invoice = PurchaseInvoiceCreateSchema.safeParse(
    arcaReceivedInvoice(
      { ...v, kind: v.kind },
      {
        channelId,
        supplierId: supplier.id,
        accountId: defaults.find((d) => d.name === "account_id")?.id ?? null,
        costCenterId:
          defaults.find((d) => d.name === "cost_center_id")?.id ?? null,
        amounts,
        split,
        cotizacion,
        fchVtoPago: supplierDueDate(supplier, v.fecha) ?? v.fecha,
        originId,
        notes: null,
      },
    ),
  );
  if (!invoice.success) {
    return {
      kind: "pending",
      reason: "error",
      message: invoice.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const res = await acceptReceivedVoucher(userId, {
    voucherId: v.id,
    invoice: invoice.data,
    gapTarget,
  });
  if (!res.ok) return { kind: "pending", reason: "error", message: res.error };
  return {
    kind: "accepted",
    linked: res.data.linkedExisting,
    supplierId: supplier.id,
  };
}

function voucherRef(v: ReceivedVoucher): string {
  const number = v.kind
    ? formatInvoiceNumber({
        kind: v.kind,
        letter: v.letter,
        punto_venta: v.punto_venta,
        numero: v.numero,
      })
    : `Tipo ${v.cbte_tipo} ${v.punto_venta}-${v.numero}`;
  return `${number} · CUIT ${v.issuer_cuit}`;
}

/** Accepts each voucher of the chunk, in order, as the owner (inside
 *  asBulkOwner). A voucher that cannot load stays pending with its reason. */
export async function acceptVoucherChunk(
  userId: string,
  ids: readonly string[],
): Promise<VoucherChunkResult> {
  const { vouchers, unreadable, ctx } = await readChunk(
    getServiceClient(),
    ids,
  );
  const pending: Partial<Record<BulkPendingReason, number>> = {};
  const counts = { accepted: 0, linked: 0, alreadyProcessed: 0 };
  const errors: NonNullable<BulkDelta["errors"]> = [];
  const affected = new Set<string>();
  let dolOpen = 0;

  for (const id of ids) {
    const v = vouchers.get(id);
    if (!v) {
      if (unreadable.has(id)) {
        pending.error = (pending.error ?? 0) + 1;
        errors.push({
          scope: "voucher",
          ref: id,
          message: "No se pudo leer el comprobante.",
        });
      } else {
        // Gone from the tray since it was listed.
        counts.alreadyProcessed++;
      }
      continue;
    }
    let outcome: Outcome;
    try {
      outcome = await acceptOne(userId, v, ctx);
    } catch (err) {
      logger.error("arca_bulk_accept.voucher_failed", {
        userId,
        voucherId: v.id,
        error: err instanceof Error ? err.message : String(err),
      });
      outcome = {
        kind: "pending",
        reason: "error",
        message: "No se pudo cargar el comprobante.",
      };
    }
    const upToOpening = v.fecha <= BULK_OPENING_DATE;
    if (outcome.kind === "accepted") {
      if (outcome.linked) counts.linked++;
      else counts.accepted++;
      if (upToOpening) {
        affected.add(outcome.supplierId);
        if (v.moneda === "DOL") dolOpen++;
      }
    } else if (outcome.kind === "already") {
      counts.alreadyProcessed++;
      // Loaded by an earlier try of this step, or by someone meanwhile.
      if (upToOpening && outcome.supplierId) affected.add(outcome.supplierId);
    } else {
      pending[outcome.reason] = (pending[outcome.reason] ?? 0) + 1;
      if (outcome.message) {
        errors.push({
          scope: "voucher",
          ref: voucherRef(v),
          message: outcome.message,
        });
      }
    }
  }
  return {
    delta: { vouchers: { ...counts, pending }, dolOpen, errors },
    affectedSupplierIds: [...affected],
  };
}

// ─── Opening balances ────────────────────────────────────────────────────────

/** Sets each supplier's opening balance at 0 on the opening date, as the
 *  owner (inside asBulkOwner): everything in pesos up to then is settled. */
export async function applyBulkOpeningBalances(
  userId: string,
  supplierIds: readonly string[],
): Promise<BulkDelta> {
  const supabase = await createClient();
  const { data: named } = await getServiceClient()
    .from("suppliers")
    .select("id, legal_name, cuit")
    .in("id", [...supplierIds]);
  const nameOf = new Map(
    (named ?? []).map((s) => [
      s.id,
      s.cuit ? `${s.legal_name} (CUIT ${s.cuit})` : s.legal_name,
    ]),
  );
  const delta = { applied: 0, failed: 0 };
  const errors: NonNullable<BulkDelta["errors"]> = [];
  for (const supplierId of supplierIds) {
    const { error } = await supabase.rpc("apply_supplier_opening_balance", {
      p_supplier_id: supplierId,
      p_opening_date: BULK_OPENING_DATE,
      p_target_balance: 0,
      p_notes: "Aceptar todos los pendientes de ARCA",
    });
    if (error) {
      const message =
        mapDbGuardError(error, {
          slug: "arca_bulk_accept.opening_rejected",
          userId,
          id: supplierId,
        }) ?? "No se pudo aplicar el saldo de apertura.";
      if (message === "No se pudo aplicar el saldo de apertura.") {
        logger.error("arca_bulk_accept.opening_failed", {
          userId,
          supplierId,
          code: error.code,
        });
      }
      delta.failed++;
      errors.push({
        scope: "opening",
        ref: nameOf.get(supplierId) ?? supplierId,
        message,
      });
      continue;
    }
    delta.applied++;
    await logAudit(
      "supplier.opening_balance.applied",
      userId,
      {
        opening_date: BULK_OPENING_DATE,
        target_balance: 0,
        source: "arca_bulk_accept",
      },
      supplierId,
    );
  }
  return { openingBalances: delta, errors };
}

export function progressWithTotals(work: BulkWork): BulkProgress {
  return {
    ...emptyBulkProgress(),
    totals: {
      vouchers: work.voucherIds.length,
      newSuppliers: work.missing.length,
    },
  };
}
