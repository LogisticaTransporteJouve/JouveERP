"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  computeStorageBilling,
  type PalletInput,
  type StorageBilling,
  type TariffInput,
} from "../lib/billing";

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

  const [palletsRes, tariffsRes, clientsRes] = await Promise.all([
    supabase
      .from("pallets")
      .select("id, client_id, code, entry_date, exit_date")
      .lte("entry_date", input.periodEnd)
      .or(`exit_date.is.null,exit_date.gte.${input.periodStart}`),
    supabase
      .from("storage_tariffs")
      .select(
        "client_id, rate_per_pallet, period, handling_in, handling_out, valid_from, valid_to, is_active",
      )
      .eq("is_active", true),
    supabase.from("clients").select("id, legal_name"),
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
