"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { readFiscalYearStartMonth } from "@/lib/fiscal-year-settings";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  UpdateAccountingSettingsSchema,
  type AccountingSettings,
} from "../schema";

export async function getAccountingSettingsAction(): Promise<
  ActionResult<AccountingSettings>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const res = await readFiscalYearStartMonth(ctx.userId);
  if (!res.ok) return res;
  return { ok: true, data: { fiscalYearStartMonth: res.data } };
}

/** Changes the month the fiscal year starts in (owner and admin). */
export async function updateAccountingSettingsAction(
  input: unknown,
): Promise<ActionResult<AccountingSettings>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:admin")) {
    return {
      ok: false,
      error: "No tenés permiso para cambiar la configuración contable.",
    };
  }
  const parsed = UpdateAccountingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const service = getServiceClient();
  const { data: before, error: readError } = await service
    .from("accounting_settings")
    .select("fiscal_year_start_month")
    .eq("id", true)
    .maybeSingle();
  if (readError || !before) {
    logger.error("accounting_settings.read.failed", {
      userId: ctx.userId,
      error: readError ?? "missing row",
    });
    return { ok: false, error: "No se pudo guardar la configuración." };
  }
  const { data, error } = await service
    .from("accounting_settings")
    .update({
      fiscal_year_start_month: parsed.data.fiscalYearStartMonth,
      updated_by: ctx.userId,
    })
    .eq("id", true)
    .select("fiscal_year_start_month")
    .single();
  if (error) {
    logger.error("accounting_settings.update.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo guardar la configuración." };
  }
  await logAudit("accounting_settings.updated", ctx.userId, {
    fiscal_year_start_month: {
      from: before.fiscal_year_start_month,
      to: data.fiscal_year_start_month,
    },
  });
  return {
    ok: true,
    data: { fiscalYearStartMonth: data.fiscal_year_start_month },
  };
}
