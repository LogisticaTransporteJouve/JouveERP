"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { invoiceStorage } from "@/lib/commands/invoice-storage";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  computeStorageBilling,
  STORAGE_TARIFF_COLUMNS,
  toTariffInput,
  type PalletInput,
  type StorageBilling,
} from "../lib/billing";
import { loadClientTariffs, type StorageRange } from "../lib/client-tariffs";
import { StorageInvoiceSchema, type StorageBillingRun } from "../schema";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Storage billing over a date range: per-pallet days × applicable tariff rate,
 * grouped by client. Computed in TS (computeStorageBilling). Gated on
 * storage_billing:read.
 */
export async function getStorageBillingAction(
  input: StorageRange,
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
 * Invoice a client's storage for an arbitrary [period_start, period_end]
 * (lib/commands/invoice-storage: recomputed server-side, claimed, issued on
 * the chosen channel and linked to the run). Gated on storage_billing:issue
 * + invoices:issue. The user's session client goes to the command: the
 * claim records the user as the run's author and the runs' RLS applies.
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
  return invoiceStorage(await createSupabaseClient(), ctx.userId, parsed.data);
}
