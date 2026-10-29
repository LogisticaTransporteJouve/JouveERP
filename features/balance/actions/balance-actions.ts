"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { PeriodSchema } from "@/lib/validation/common";

import type { AccountBalanceRow } from "../schema";

const GetAccountBalancesInput = z.object({
  periodEnd: PeriodSchema,
  periodStart: PeriodSchema.nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
});

export async function getAccountBalancesAction(input: {
  periodEnd: string;
  periodStart?: string | null;
  costCenterId?: string | null;
}): Promise<ActionResult<AccountBalanceRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = GetAccountBalancesInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  input = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_account_balances", {
    p_period_end: input.periodEnd,
    p_period_start: input.periodStart ?? undefined,
    p_cost_center_id: input.costCenterId ?? undefined,
  });
  if (error) {
    logger.error("get_account_balances.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los saldos." };
  }
  return { ok: true, data: (data ?? []) as AccountBalanceRow[] };
}
