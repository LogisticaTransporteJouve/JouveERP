"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import type { AccountBalanceRow } from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const PERIOD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export async function getAccountBalancesAction(input: {
  periodEnd: string;
  periodStart?: string | null;
}): Promise<ActionResult<AccountBalanceRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  if (!PERIOD_RE.test(input.periodEnd)) {
    return { ok: false, error: "Período fin inválido (YYYY-MM)." };
  }
  if (input.periodStart && !PERIOD_RE.test(input.periodStart)) {
    return { ok: false, error: "Período inicio inválido (YYYY-MM)." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_account_balances", {
    p_period_end: input.periodEnd,
    p_period_start: input.periodStart ?? undefined,
  });
  if (error) {
    logger.error("get_account_balances.failed", { error });
    return { ok: false, error: "No se pudieron leer los saldos." };
  }
  return { ok: true, data: (data ?? []) as unknown as AccountBalanceRow[] };
}
