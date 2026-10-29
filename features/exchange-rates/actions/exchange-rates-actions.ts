"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { upsertManualExchangeRate } from "@/lib/commands/upsert-exchange-rate";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  ExchangeRateCreateSchema,
  ExchangeRateDeleteSchema,
  findRateForDate,
  isoDate,
  type ExchangeRate,
} from "../schema";

export async function listExchangeRatesAction(): Promise<
  ActionResult<ExchangeRate[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("id, currency, rate_date, rate, source, notes, created_at")
    .order("rate_date", { ascending: false })
    .limit(500);
  if (error) {
    logger.error("exchange_rates.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer las cotizaciones." };
  }
  return { ok: true, data: (data ?? []) as ExchangeRate[] };
}

export async function createExchangeRateAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = ExchangeRateCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido." };
  }
  return upsertManualExchangeRate(ctx.userId, parsed.data);
}

export async function deleteExchangeRateAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = ExchangeRateDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("exchange_rates")
    .delete()
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("exchange_rates.delete.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo borrar la cotización." };
  }
  await logAudit("exchange_rate.deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

// Entry point for "conversion logic": the USD→ARS rate applicable to a
// date (the one for that day or the nearest earlier one), or null if there
// is none.
export async function getUsdRateForDateAction(
  date: string,
): Promise<ActionResult<{ rate: number | null }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsedDate = isoDate.safeParse(date);
  if (!parsedDate.success) {
    return { ok: false, error: "Fecha inválida." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("rate_date, rate")
    .eq("currency", "USD")
    .lte("rate_date", parsedDate.data)
    .order("rate_date", { ascending: false })
    .limit(1);
  if (error) {
    logger.error("exchange_rates.rate_for_date.failed", {
      userId: ctx.userId,
      date,
      error,
    });
    return { ok: false, error: "No se pudo leer la cotización." };
  }
  const rate = findRateForDate(data ?? [], parsedDate.data);
  return { ok: true, data: { rate } };
}
