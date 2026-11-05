"use server";

import { logAudit } from "@/lib/actions/audit";
import { CONCEPTO, IVA_RATE, MONEDA, voucherReceptor } from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { round2, todayInAR } from "@/lib/format";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { fetchUsdRateOnOrBefore } from "@/lib/fx";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { invoiceIsVoid } from "@/lib/source-invoice-key";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  isClientTariffConcept,
  STORAGE_TARIFF_CONCEPTS,
  isClientTariffCurrency,
  isClientTariffUnit,
} from "@/features/client-tariffs/schema";
import { isIvaCondition } from "@/features/clients/schema";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import type { CreateComprobanteInput } from "@/features/invoices/schema";

import {
  computeStorageBilling,
  STORAGE_TARIFF_COLUMNS,
  toTariffInput,
  type ClientTariffInput,
  type PalletInput,
  type StorageBilling,
} from "../lib/billing";
import { StorageInvoiceSchema, type StorageBillingRun } from "../schema";

type RangeInput = { periodStart: string; periodEnd: string };

type ServiceClient = ReturnType<typeof getServiceClient>;

/**
 * The client tariffs that touch [periodStart, periodEnd] (one client's, or
 * every client's) and, when one of them is in USD, the official rate on or
 * before periodEnd (null when none is loaded). Drained past max_rows: a
 * truncated read would bill at the fallback tariff silently.
 */
async function loadClientTariffs(
  supabase: ServiceClient,
  range: RangeInput,
  clientId: string | null,
): Promise<
  | { ok: true; clientTariffs: ClientTariffInput[]; usdRate: number | null }
  | { ok: false; error: unknown }
> {
  const res = await paginateRange((from, to) => {
    let q = supabase
      .from("client_tariffs")
      .select(
        "id, client_id, concept, unit, price, currency, valid_from, valid_to, area_id",
      )
      .in("concept", [...STORAGE_TARIFF_CONCEPTS])
      .lte("valid_from", range.periodEnd)
      .or(`valid_to.is.null,valid_to.gte.${range.periodStart}`);
    if (clientId) q = q.eq("client_id", clientId);
    return q.order("id").range(from, to);
  });
  if (res.error) return { ok: false, error: res.error };

  const clientTariffs: ClientTariffInput[] = [];
  for (const t of res.data ?? []) {
    if (
      !isClientTariffConcept(t.concept) ||
      !isClientTariffUnit(t.unit) ||
      !isClientTariffCurrency(t.currency)
    ) {
      // A row this code cannot price must not bill at the fallback quietly.
      return { ok: false, error: { unknownTariff: t.id } };
    }
    clientTariffs.push({
      client_id: t.client_id,
      concept: t.concept,
      unit: t.unit,
      price: Number(t.price),
      currency: t.currency,
      valid_from: t.valid_from,
      valid_to: t.valid_to,
      area_id: t.area_id,
    });
  }

  const usdRate = clientTariffs.some((t) => t.currency === "USD")
    ? ((await fetchUsdRateOnOrBefore(supabase, range.periodEnd))?.rate ?? null)
    : null;
  return { ok: true, clientTariffs, usdRate };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Storage billing over a date range: per-pallet days × applicable tariff rate,
 * grouped by client. Computed in TS (computeStorageBilling). Gated on
 * storage_billing:read.
 */
export async function getStorageBillingAction(
  input: RangeInput,
): Promise<ActionResult<StorageBilling>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "storage_billing:read")) {
    return { ok: false, error: "No tenés permiso para ver la facturación." };
  }
  if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd)) {
    return { ok: false, error: "Rango de fechas inválido." };
  }

  // Service client after the gate: billing reads pallets, which the pallets
  // RLS limits to the warehouse roles, so finance (who bills) saw none.
  const supabase = getServiceClient();

  // Drained past max_rows: a truncated pallet, tariff or client list would
  // under-bill silently.
  const [palletsRes, tariffsRes, clientsRes, ownRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("pallets")
        .select("id, client_id, code, entry_date, exit_date, area_id")
        .lte("entry_date", input.periodEnd)
        .or(`exit_date.is.null,exit_date.gte.${input.periodStart}`)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("storage_tariffs")
        .select(STORAGE_TARIFF_COLUMNS)
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("clients")
        .select("id, legal_name, is_fiscal")
        .order("id")
        .range(from, to),
    ),
    loadClientTariffs(supabase, input, null),
  ]);

  const firstError =
    palletsRes.error ??
    tariffsRes.error ??
    clientsRes.error ??
    (ownRes.ok ? null : ownRes.error);
  if (firstError || !ownRes.ok) {
    logger.error("storage.billing.failed", {
      userId: ctx.userId,
      error: firstError,
    });
    return { ok: false, error: "No se pudo calcular la facturación." };
  }

  const pallets: PalletInput[] = (palletsRes.data ?? []).map((p) => ({
    id: p.id,
    client_id: p.client_id,
    code: p.code,
    entry_date: p.entry_date,
    exit_date: p.exit_date,
    area_id: p.area_id,
  }));

  const tariffs = (tariffsRes.data ?? []).map(toTariffInput);

  const clientNames = new Map<string, string>();
  const clientIsFiscal = new Map<string, boolean>();
  for (const c of clientsRes.data ?? []) {
    clientNames.set(c.id, c.legal_name);
    clientIsFiscal.set(c.id, c.is_fiscal);
  }

  return {
    ok: true,
    data: computeStorageBilling({
      pallets,
      tariffs,
      clientTariffs: ownRes.clientTariffs,
      usdRate: ownRes.usdRate,
      clientNames,
      clientIsFiscal,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    }),
  };
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * claim_storage_billing_period_with_relinks links a stale run's orphan
 * invoice (issued under the run's id) instead of deleting the run, for any
 * of the client's periods and channels, and returns those runs. That lost
 * link never wrote `storage.invoiced`, so write it now, marked `relinked`,
 * for each of them whose invoice carries the run's id and has no event yet.
 * A run linked on the normal path is never among them. Best effort, like
 * logAudit: a failed read only logs.
 */
async function auditRelinkedRuns(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  userId: string,
  clientId: string,
  relinkedRunIds: string[],
): Promise<void> {
  if (relinkedRunIds.length === 0) return;
  const runsRes = await fetchInChunks(relinkedRunIds, (ids) =>
    supabase
      .from("storage_billing_runs")
      .select("id, invoice_id, period_start, period_end, total")
      .in("id", ids)
      .not("invoice_id", "is", null),
  );
  if (runsRes.error) {
    logger.error("storage.invoice.relink_audit.failed", {
      userId,
      error: runsRes.error,
    });
    return;
  }
  const linked = runsRes.data.filter(
    (r): r is typeof r & { invoice_id: string } => r.invoice_id !== null,
  );
  if (linked.length === 0) return;

  const invoiceIds = linked.map((r) => r.invoice_id);
  const [invoicesRes, auditRes] = await Promise.all([
    fetchInChunks(invoiceIds, (ids) =>
      supabase.from("invoices").select("id, idempotency_key").in("id", ids),
    ),
    fetchInChunks(invoiceIds, (ids) =>
      getServiceClient()
        .from("audit_events")
        .select("target_resource_id")
        .eq("event_type", "storage.invoiced")
        .in("target_resource_id", ids),
    ),
  ]);
  if (invoicesRes.error || auditRes.error) {
    logger.error("storage.invoice.relink_audit.failed", {
      userId,
      error: invoicesRes.error ?? auditRes.error,
    });
    return;
  }
  const keyOf = new Map(invoicesRes.data.map((i) => [i.id, i.idempotency_key]));
  const audited = new Set(auditRes.data.map((a) => a.target_resource_id));
  for (const run of linked) {
    if (keyOf.get(run.invoice_id) !== run.id) continue;
    if (audited.has(run.invoice_id)) continue;
    await logAudit(
      "storage.invoiced",
      userId,
      {
        invoice_id: run.invoice_id,
        client_id: clientId,
        period_start: run.period_start,
        period_end: run.period_end,
        total: Number(run.total),
        relinked: true,
      },
      run.invoice_id,
    );
  }
}

/**
 * History of billed storage periods. Feeds the "facturado hasta" indicator and
 * the gap/overlap checks per client. Gated on storage_billing:read.
 */
export async function listStorageBillingRunsAction(): Promise<
  ActionResult<StorageBillingRun[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "storage_billing:read")) {
    return { ok: false, error: "No tenés permiso para ver la facturación." };
  }
  const supabase = await createSupabaseClient();
  const [runsRes, voidRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("storage_billing_runs")
        .select(
          "id, client_id, period_start, period_end, storage_total, handling_in_total, handling_out_total, total, invoice_id, channel_id, pending_since, created_at, client:clients(legal_name)",
        )
        .order("period_end", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    // Runs whose invoice no longer bills them (failed, cancelled, or a fiscal
    // factura credited in full): their days are free, and the next claim of
    // the client deletes them.
    supabase.rpc("storage_billing_void_run_ids"),
  ]);
  const error = runsRes.error ?? voidRes.error;
  if (error) {
    logger.error("storage.billing.runs.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el historial." };
  }
  const voidRuns = new Set(voidRes.data ?? []);
  const runs: StorageBillingRun[] = (runsRes.data ?? [])
    .filter((r) => !voidRuns.has(r.id))
    .map((r) => ({
      id: r.id,
      client_id: r.client_id,
      client_name: r.client?.legal_name ?? "—",
      period_start: r.period_start,
      period_end: r.period_end,
      storage_total: Number(r.storage_total),
      handling_in_total: Number(r.handling_in_total),
      handling_out_total: Number(r.handling_out_total),
      total: Number(r.total),
      invoice_id: r.invoice_id,
      channel_id: r.channel_id,
      pending_since: r.pending_since,
      created_at: r.created_at,
    }));
  return { ok: true, data: runs };
}

/**
 * Invoice a client's storage for an arbitrary [period_start, period_end].
 * Recomputes the amounts server-side (authoritative), emits the invoice via the
 * chosen channel (fiscal → AFIP; internal → local numbering), and records the
 * run so the period can't be billed twice. Lines: Almacenaje / Carga / Descarga,
 * each labelled with the period dates. Gated on storage_billing:issue + invoices:issue.
 */
export async function invoiceStorageAction(
  input: unknown,
): Promise<ActionResult<{ invoiceId: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "storage_billing:issue") ||
    !userCan(ctx.access, "invoices:issue")
  ) {
    return { ok: false, error: "No tenés permiso para facturar almacenaje." };
  }
  const parsed = StorageInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { client_id, period_start, period_end, channel_id, punto_venta } =
    parsed.data;

  const supabase = await createSupabaseClient();

  // A Ventas client needs a CUIT + valid IVA condition to invoice; an Otras
  // ventas client has neither and gets a remito interno.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, legal_name, cuit, iva_condition, is_fiscal")
    .eq("id", client_id)
    .maybeSingle();
  if (clientErr || !client) {
    return { ok: false, error: "No se encontró el cliente." };
  }
  if (client.is_fiscal && !client.cuit) {
    return { ok: false, error: "El cliente necesita un CUIT para facturar." };
  }
  const ivaCondition = isIvaCondition(client.iva_condition)
    ? client.iva_condition
    : null;
  if (client.is_fiscal && !ivaCondition) {
    return { ok: false, error: "La condición de IVA del cliente es inválida." };
  }

  // Recompute this client's storage for the period (authoritative).
  // Drained past max_rows, like the preview: a truncated read would bill
  // less than the preview showed.
  // Pallets through the service client (after the gate above), as in the
  // preview: their RLS leaves finance out.
  const reader = getServiceClient();
  const [palletsRes, tariffsRes, ownRes] = await Promise.all([
    paginateRange((from, to) =>
      reader
        .from("pallets")
        .select("id, client_id, code, entry_date, exit_date, area_id")
        .eq("client_id", client_id)
        .lte("entry_date", period_end)
        .or(`exit_date.is.null,exit_date.gte.${period_start}`)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("storage_tariffs")
        .select(STORAGE_TARIFF_COLUMNS)
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
    loadClientTariffs(
      reader,
      { periodStart: period_start, periodEnd: period_end },
      client_id,
    ),
  ]);
  if (palletsRes.error || tariffsRes.error || !ownRes.ok) {
    logger.error("storage.invoice.compute.failed", {
      userId: ctx.userId,
      error:
        palletsRes.error ??
        tariffsRes.error ??
        (ownRes.ok ? null : ownRes.error),
    });
    return { ok: false, error: "No se pudo calcular el almacenaje." };
  }
  const pallets: PalletInput[] = (palletsRes.data ?? []).map((p) => ({
    id: p.id,
    client_id: p.client_id,
    code: p.code,
    entry_date: p.entry_date,
    exit_date: p.exit_date,
    area_id: p.area_id,
  }));
  const tariffs = (tariffsRes.data ?? []).map(toTariffInput);
  const billing = computeStorageBilling({
    pallets,
    tariffs,
    clientTariffs: ownRes.clientTariffs,
    usdRate: ownRes.usdRate,
    clientNames: new Map([[client_id, client.legal_name]]),
    periodStart: period_start,
    periodEnd: period_end,
  });
  // A USD tariff without a rate would bill its days at nothing.
  if (billing.pallets_without_rate > 0) {
    return {
      ok: false,
      error: `Falta la cotización del dólar al ${fmtDate(period_end)} (o anterior) para las tarifas en USD del cliente. Cargala en Contabilidad › Cotización USD y volvé a facturar.`,
    };
  }
  const storage = billing.storage_total;
  const loading = round2(
    billing.lines.reduce((s, l) => s + l.handling_in_charge, 0),
  );
  const unloading = round2(
    billing.lines.reduce((s, l) => s + l.handling_out_charge, 0),
  );
  const total = round2(storage + loading + unloading);
  if (total <= 0) {
    return { ok: false, error: "No hay nada para facturar en ese período." };
  }

  const label = `${fmtDate(period_start)}–${fmtDate(period_end)}`;
  const items: CreateComprobanteInput["items"] = [];
  if (storage > 0) {
    items.push({
      description: `Almacenaje ${label}`,
      quantity: 1,
      unit_price: storage,
      iva_rate_id: IVA_RATE.TWENTY_ONE,
    });
  }
  if (loading > 0) {
    items.push({
      description: `Carga ${label}`,
      quantity: 1,
      unit_price: loading,
      iva_rate_id: IVA_RATE.TWENTY_ONE,
    });
  }
  if (unloading > 0) {
    items.push({
      description: `Descarga ${label}`,
      quantity: 1,
      unit_price: unloading,
      iva_rate_id: IVA_RATE.TWENTY_ONE,
    });
  }

  // Claim the period before issuing: the RPC checks overlap under a per-client
  // lock and inserts a pending run, so a concurrent click is refused instead
  // of billing the same days twice. The invoice is issued under the run's id,
  // so a later claim links an invoice whose link was lost instead of billing
  // the days again; such a claim returns no run.
  const { data: claimRows, error: claimErr } = await supabase.rpc(
    "claim_storage_billing_period_with_relinks",
    {
      p_client_id: client_id,
      p_channel_id: channel_id,
      p_period_start: period_start,
      p_period_end: period_end,
    },
  );
  if (claimErr) {
    const guardError = mapDbGuardError(claimErr, {
      slug: "storage.invoice.claim_rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("storage.invoice.claim_failed", {
      userId: ctx.userId,
      error: claimErr,
    });
    return { ok: false, error: "No se pudo validar el período." };
  }
  const claimRow = claimRows?.[0];
  // The claim may have linked the orphan invoice of another period too.
  await auditRelinkedRuns(
    supabase,
    ctx.userId,
    client_id,
    claimRow?.relinked_run_ids ?? [],
  );
  const runId: string | null = claimRow?.run_id ?? null;
  if (!runId) {
    return {
      ok: false,
      error:
        "Ese período ya está facturado: se registró la factura que había quedado sin vincular. La encontrás entre los comprobantes del cliente: Ventas › Comprobantes, u Otras ventas › Remitos internos si es interna.",
    };
  }

  const releaseRun = async () => {
    const { error: releaseErr } = await supabase
      .from("storage_billing_runs")
      .delete()
      .eq("id", runId)
      .is("invoice_id", null);
    if (releaseErr) {
      logger.error("storage.invoice.release_failed", {
        userId: ctx.userId,
        runId,
        error: releaseErr,
      });
    }
  };

  // The totals go on the run before the issue, so a run whose invoice a
  // later claim links still carries them.
  const { error: totalsErr } = await supabase
    .from("storage_billing_runs")
    .update({
      storage_total: storage,
      handling_in_total: loading,
      handling_out_total: unloading,
      total,
      applied_tariffs: billing.applied_tariffs,
    })
    .eq("id", runId);
  if (totalsErr) {
    logger.error("storage.invoice.run_totals.failed", {
      userId: ctx.userId,
      runId,
      error: totalsErr,
    });
    await releaseRun();
    return { ok: false, error: "No se pudo registrar el período." };
  }

  const today = todayInAR();
  const result = await issueFiscalInvoiceAction({
    channel_id,
    client_id,
    kind: "factura",
    letter: null,
    punto_venta,
    fecha: today,
    fch_serv_desde: period_start,
    fch_serv_hasta: period_end,
    fch_vto_pago: today,
    concepto: CONCEPTO.SERVICIOS,
    ...voucherReceptor({ cuit: client.cuit, iva_condition: ivaCondition }),
    moneda: MONEDA.PESOS,
    cotizacion: 1,
    items,
    idempotency_key: runId,
  });
  if (!result.ok) {
    await releaseRun();
    return result;
  }

  const { error: linkErr } = await supabase
    .from("storage_billing_runs")
    .update({ invoice_id: result.data.id, pending_since: null })
    .eq("id", runId);
  if (linkErr) {
    logger.error("storage.invoice.run_link.failed", {
      userId: ctx.userId,
      invoiceId: result.data.id,
      error: linkErr,
    });
    // The invoice already failed or was cancelled (the link guard refuses
    // it): nothing holds the period, so free it now. Any other error keeps
    // the run pending; once it is stale, the next claim links this invoice.
    if (await invoiceIsVoid(supabase, result.data.id)) {
      await releaseRun();
      return {
        ok: false,
        error:
          "La factura falló o se anuló antes de registrar el período: el período quedó libre para facturarlo de nuevo.",
      };
    }
    return {
      ok: false,
      error:
        "La factura se emitió pero el período no quedó registrado. No la emitas de nuevo: pasados 15 minutos, «Facturar» el mismo período registra esta factura sin emitir otra.",
    };
  }

  await logAudit(
    "storage.invoiced",
    ctx.userId,
    { invoice_id: result.data.id, client_id, period_start, period_end, total },
    result.data.id,
  );
  return { ok: true, data: { invoiceId: result.data.id } };
}
