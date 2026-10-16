"use server";

import { logAudit } from "@/lib/actions/audit";
import {
  CONCEPTO,
  DOC_TIPO,
  IVA_RATE,
  MONEDA,
  condicionIvaReceptorFor,
} from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { round2, todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { isIvaCondition } from "@/features/clients/schema";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import type { CreateComprobanteInput } from "@/features/invoices/schema";

import {
  computeStorageBilling,
  type PalletInput,
  type StorageBilling,
  type TariffInput,
} from "../lib/billing";
import { overlapsBilled } from "../lib/continuity";
import { StorageInvoiceSchema, type StorageBillingRun } from "../schema";

type RangeInput = { periodStart: string; periodEnd: string };

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
  if (!userCan(ctx.roles, "storage_billing:read")) {
    return { ok: false, error: "No tenés permiso para ver la facturación." };
  }
  if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd)) {
    return { ok: false, error: "Rango de fechas inválido." };
  }

  const supabase = await createSupabaseClient();

  // Drained past max_rows: a truncated pallet, tariff or client list would
  // under-bill silently.
  const [palletsRes, tariffsRes, clientsRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("pallets")
        .select("id, client_id, code, entry_date, exit_date")
        .lte("entry_date", input.periodEnd)
        .or(`exit_date.is.null,exit_date.gte.${input.periodStart}`)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("storage_tariffs")
        .select(
          "client_id, rate_per_pallet, period, handling_in, handling_out, valid_from, valid_to, is_active",
        )
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("clients")
        .select("id, legal_name")
        .order("id")
        .range(from, to),
    ),
  ]);

  const firstError = palletsRes.error ?? tariffsRes.error ?? clientsRes.error;
  if (firstError) {
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
  }));

  const tariffs: TariffInput[] = (tariffsRes.data ?? []).map((t) => ({
    client_id: t.client_id,
    rate_per_pallet: Number(t.rate_per_pallet),
    period: t.period,
    handling_in: Number(t.handling_in),
    handling_out: Number(t.handling_out),
    valid_from: t.valid_from,
    valid_to: t.valid_to,
    is_active: t.is_active,
  }));

  const clientNames = new Map<string, string>();
  for (const c of clientsRes.data ?? []) clientNames.set(c.id, c.legal_name);

  return {
    ok: true,
    data: computeStorageBilling({
      pallets,
      tariffs,
      clientNames,
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
 * History of billed storage periods. Feeds the "facturado hasta" indicator and
 * the gap/overlap checks per client. Gated on storage_billing:read.
 */
export async function listStorageBillingRunsAction(): Promise<
  ActionResult<StorageBillingRun[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:read")) {
    return { ok: false, error: "No tenés permiso para ver la facturación." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("storage_billing_runs")
      .select(
        "id, client_id, period_start, period_end, storage_total, handling_in_total, handling_out_total, total, invoice_id, created_at, client:clients(legal_name)",
      )
      .order("period_end", { ascending: false })
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("storage.billing.runs.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el historial." };
  }
  const runs: StorageBillingRun[] = (data ?? []).map((r) => ({
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
    !userCan(ctx.roles, "storage_billing:issue") ||
    !userCan(ctx.roles, "invoices:issue")
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

  // Guard against double-billing: no overlap with an already-billed period.
  const { data: existingRuns, error: runsErr } = await supabase
    .from("storage_billing_runs")
    .select("period_start, period_end")
    .eq("client_id", client_id);
  if (runsErr) {
    logger.error("storage.invoice.runs_read.failed", {
      userId: ctx.userId,
      error: runsErr,
    });
    return { ok: false, error: "No se pudo validar el período." };
  }
  if (overlapsBilled(existingRuns ?? [], period_start, period_end)) {
    return {
      ok: false,
      error:
        "Ese período ya fue facturado (total o parcialmente) para este cliente.",
    };
  }

  // The client needs a CUIT + valid IVA condition to invoice.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, legal_name, cuit, iva_condition")
    .eq("id", client_id)
    .maybeSingle();
  if (clientErr || !client) {
    return { ok: false, error: "No se encontró el cliente." };
  }
  if (!client.cuit) {
    return { ok: false, error: "El cliente necesita un CUIT para facturar." };
  }
  if (!isIvaCondition(client.iva_condition)) {
    return { ok: false, error: "La condición de IVA del cliente es inválida." };
  }

  // Recompute this client's storage for the period (authoritative).
  const [palletsRes, tariffsRes] = await Promise.all([
    supabase
      .from("pallets")
      .select("id, client_id, code, entry_date, exit_date")
      .eq("client_id", client_id)
      .lte("entry_date", period_end)
      .or(`exit_date.is.null,exit_date.gte.${period_start}`),
    supabase
      .from("storage_tariffs")
      .select(
        "client_id, rate_per_pallet, period, handling_in, handling_out, valid_from, valid_to, is_active",
      )
      .eq("is_active", true),
  ]);
  if (palletsRes.error || tariffsRes.error) {
    logger.error("storage.invoice.compute.failed", {
      userId: ctx.userId,
      error: palletsRes.error ?? tariffsRes.error,
    });
    return { ok: false, error: "No se pudo calcular el almacenaje." };
  }
  const pallets: PalletInput[] = (palletsRes.data ?? []).map((p) => ({
    id: p.id,
    client_id: p.client_id,
    code: p.code,
    entry_date: p.entry_date,
    exit_date: p.exit_date,
  }));
  const tariffs: TariffInput[] = (tariffsRes.data ?? []).map((t) => ({
    client_id: t.client_id,
    rate_per_pallet: Number(t.rate_per_pallet),
    period: t.period,
    handling_in: Number(t.handling_in),
    handling_out: Number(t.handling_out),
    valid_from: t.valid_from,
    valid_to: t.valid_to,
    is_active: t.is_active,
  }));
  const billing = computeStorageBilling({
    pallets,
    tariffs,
    clientNames: new Map([[client_id, client.legal_name]]),
    periodStart: period_start,
    periodEnd: period_end,
  });
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
    doc_tipo: DOC_TIPO.CUIT,
    doc_nro: client.cuit,
    iva_condition_receptor: condicionIvaReceptorFor(client.iva_condition),
    moneda: MONEDA.PESOS,
    cotizacion: 1,
    items,
  });
  if (!result.ok) return result;

  const { error: insertErr } = await supabase
    .from("storage_billing_runs")
    .insert({
      client_id,
      period_start,
      period_end,
      storage_total: storage,
      handling_in_total: loading,
      handling_out_total: unloading,
      total,
      applied_tariffs: billing.applied_tariffs,
      invoice_id: result.data.id,
      created_by: ctx.userId,
    });
  if (insertErr) {
    logger.error("storage.invoice.run_insert.failed", {
      userId: ctx.userId,
      invoiceId: result.data.id,
      error: insertErr,
    });
    return {
      ok: false,
      error:
        "La factura se emitió pero no se registró el período. Anotá el comprobante antes de volver a facturar.",
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
