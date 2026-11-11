import "server-only";

import { currentVacationPeriodYear } from "@/features/hr/lib/vacation-periods";
import {
  DRIVER_POSITION,
  driverRecordPatch,
  type EmployeeCreateInput,
} from "@/features/hr/schema";
import { logAudit } from "@/lib/actions/audit";
import { userCan, type Access } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * "Nuevo empleado": the employee, its driver record (a driver position,
 * Flota → Choferes) and its vacation days in one transaction (RPC
 * `create_employee`), with the caller's session, then the audit. The caller
 * has already checked `hr:write` and parsed the input with
 * `EmployeeCreateSchema`: the employee form and an accepted assistant
 * proposal. Vacation days are loaded only for `hr:admin`, like the
 * balances' RLS; anyone else's figures are left out.
 */
export async function createEmployee(
  actor: { userId: string; access: Access },
  input: EmployeeCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const loadsVacations =
    (input.vacation_current_days != null ||
      input.vacation_previous_days != null) &&
    userCan(actor.access, "hr:admin");
  const currentDays = loadsVacations
    ? (input.vacation_current_days ?? null)
    : null;
  const previousDays = loadsVacations
    ? (input.vacation_previous_days ?? null)
    : null;
  const today = todayInAR();

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("create_employee", {
    p_employee: {
      legal_name: input.legal_name,
      position: input.position ?? null,
      cuil: input.cuil ?? null,
      cbu: input.cbu ?? null,
      pay_frequency: input.pay_frequency,
      pay_mode: input.pay_mode,
      base_salary: input.base_salary ?? null,
      viatico_monthly: input.viatico_monthly,
      is_monotributo: input.is_monotributo,
      hire_date: input.hire_date,
      notes: input.notes ?? null,
      convenio: input.convenio ?? null,
      categoria: input.categoria ?? null,
      obra_social: input.obra_social ?? null,
      art: input.art ?? null,
      retribucion_formal: input.retribucion_formal ?? null,
      created_by: actor.userId,
    },
    p_driver_position: DRIVER_POSITION,
    p_driver: driverRecordPatch(input),
    p_current_days: currentDays ?? undefined,
    p_previous_days: previousDays ?? undefined,
    p_today: today,
  });

  if (error || !id) {
    const guardError = mapDbGuardError(error, {
      slug: "employees.create.rejected",
      userId: actor.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("employees.create.failed", {
      userId: actor.userId,
      legal_name: input.legal_name,
      error,
    });
    return { ok: false, error: "No se pudo crear el empleado." };
  }

  await logAudit(
    "employee.created",
    actor.userId,
    {
      legal_name: input.legal_name,
      pay_frequency: input.pay_frequency,
      pay_mode: input.pay_mode,
      base_salary: input.base_salary ?? null,
    },
    id,
  );
  if (loadsVacations) {
    await logAudit(
      "employee.vacation_balance_set",
      actor.userId,
      {
        period_year: currentVacationPeriodYear(today),
        current_days: currentDays,
        previous_days: previousDays,
      },
      id,
    );
  }
  return { ok: true, data: { id } };
}
