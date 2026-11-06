import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isIvaCondition } from "@/features/clients/schema";
import {
  CreateComprobanteSchema,
  type CreateComprobanteInput,
} from "@/features/invoices/schema";
import {
  computeStorageBilling,
  STORAGE_TARIFF_COLUMNS,
  storageInvoiceAmounts,
  toTariffInput,
  type PalletInput,
} from "@/features/storage-billing/lib/billing";
import { loadClientTariffs } from "@/features/storage-billing/lib/client-tariffs";
import type { StorageInvoiceInput } from "@/features/storage-billing/schema";
import { logAudit } from "@/lib/actions/audit";
import { CONCEPTO, IVA_RATE, MONEDA, voucherReceptor } from "@/lib/afip/codes";
import { issueComprobante } from "@/lib/commands/issue-comprobante";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { formatMoney, round2, todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { invoiceIsVoid } from "@/lib/source-invoice-key";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

type UserDb = SupabaseClient<Database>;

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
  db: UserDb,
  userId: string,
  clientId: string,
  relinkedRunIds: string[],
): Promise<void> {
  if (relinkedRunIds.length === 0) return;
  const runsRes = await fetchInChunks(relinkedRunIds, (ids) =>
    db
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
      db.from("invoices").select("id, idempotency_key").in("id", ids),
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
 * Invoices a client's storage for [period_start, period_end]: recomputes the
 * amounts server-side (authoritative), claims the period, issues the invoice
 * on the chosen channel (fiscal → AFIP; internal → remito interno) under the
 * run's id, links it to the run and audits `storage.invoiced`. Lines:
 * Almacenaje / Carga / Descarga, each labelled with the period dates.
 *
 * `db` is the user's session client: the claim RPC is SECURITY INVOKER and
 * records `auth.uid()` as the run's author, and the runs' RLS applies as in
 * the page. Pallets and client tariffs are read through the service client
 * (their RLS leaves finance out). With `expectedTotal` (an accepted
 * assistant proposal, which showed that total) a recomputed total that
 * differs is refused before anything is claimed.
 *
 * The caller has already checked `storage_billing:issue` + `invoices:issue`
 * and parsed the input with `StorageInvoiceSchema`: the Facturar dialog and
 * the proposal.
 */
export async function invoiceStorage(
  db: UserDb,
  actorId: string,
  d: StorageInvoiceInput,
  expectedTotal?: number,
): Promise<ActionResult<{ invoiceId: string }>> {
  const { client_id, period_start, period_end, channel_id, punto_venta } = d;

  // A Ventas client needs a CUIT + valid IVA condition to invoice; an Otras
  // ventas client has neither and gets a remito interno.
  const { data: client, error: clientErr } = await db
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
  // Pallets through the service client (after the caller's gate), as in the
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
      db
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
      userId: actorId,
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
  const { storage, loading, unloading, total } = storageInvoiceAmounts(
    billing.lines,
    client_id,
  );
  if (total <= 0) {
    return { ok: false, error: "No hay nada para facturar en ese período." };
  }
  if (expectedTotal !== undefined && total !== round2(expectedTotal)) {
    return {
      ok: false,
      error: `El almacenaje del período cambió desde la propuesta: ahora da ${formatMoney(total)} (antes ${formatMoney(expectedTotal)}). Pedí la propuesta de nuevo.`,
    };
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
  const { data: claimRows, error: claimErr } = await db.rpc(
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
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("storage.invoice.claim_failed", {
      userId: actorId,
      error: claimErr,
    });
    return { ok: false, error: "No se pudo validar el período." };
  }
  const claimRow = claimRows?.[0];
  // The claim may have linked the orphan invoice of another period too.
  await auditRelinkedRuns(
    db,
    actorId,
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
    const { error: releaseErr } = await db
      .from("storage_billing_runs")
      .delete()
      .eq("id", runId)
      .is("invoice_id", null);
    if (releaseErr) {
      logger.error("storage.invoice.release_failed", {
        userId: actorId,
        runId,
        error: releaseErr,
      });
    }
  };

  // The totals go on the run before the issue, so a run whose invoice a
  // later claim links still carries them.
  const { error: totalsErr } = await db
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
      userId: actorId,
      runId,
      error: totalsErr,
    });
    await releaseRun();
    return { ok: false, error: "No se pudo registrar el período." };
  }

  const today = todayInAR();
  const voucher = CreateComprobanteSchema.safeParse({
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
  } satisfies CreateComprobanteInput);
  if (!voucher.success) {
    await releaseRun();
    return {
      ok: false,
      error: voucher.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const result = await issueComprobante(actorId, voucher.data);
  if (!result.ok) {
    await releaseRun();
    return result;
  }

  const { error: linkErr } = await db
    .from("storage_billing_runs")
    .update({ invoice_id: result.data.id, pending_since: null })
    .eq("id", runId);
  if (linkErr) {
    logger.error("storage.invoice.run_link.failed", {
      userId: actorId,
      invoiceId: result.data.id,
      error: linkErr,
    });
    // The invoice already failed or was cancelled (the link guard refuses
    // it): nothing holds the period, so free it now. Any other error keeps
    // the run pending; once it is stale, the next claim links this invoice.
    if (await invoiceIsVoid(db, result.data.id)) {
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
    actorId,
    { invoice_id: result.data.id, client_id, period_start, period_end, total },
    result.data.id,
  );
  return { ok: true, data: { invoiceId: result.data.id } };
}
