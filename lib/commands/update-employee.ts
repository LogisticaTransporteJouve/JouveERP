import "server-only";

import { z } from "zod";

import {
  DRIVER_POSITION,
  driverRecordPatch,
  type EmployeeUpdateInput,
} from "@/features/hr/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/** What update_employee returns: the row before the edit (null: not found). */
const PreviousEmployeeSchema = z.object({
  legal_name: z.string(),
  base_salary: z.number().nullable(),
});

type EmployeeUpdate = Database["public"]["Tables"]["employees"]["Update"];

/** The employee columns the input sent (an absent key keeps the stored one). */
function employeePatch(rest: Omit<EmployeeUpdateInput, "id">): EmployeeUpdate {
  const patch: EmployeeUpdate = {};
  if (rest.legal_name !== undefined) patch.legal_name = rest.legal_name;
  if (rest.position !== undefined) patch.position = rest.position ?? null;
  if (rest.cuil !== undefined) patch.cuil = rest.cuil ?? null;
  if (rest.cbu !== undefined) patch.cbu = rest.cbu ?? null;
  if (rest.pay_frequency !== undefined)
    patch.pay_frequency = rest.pay_frequency;
  if (rest.base_salary !== undefined)
    patch.base_salary = rest.base_salary ?? null;
  if (rest.viatico_monthly !== undefined)
    patch.viatico_monthly = rest.viatico_monthly;
  if (rest.is_monotributo !== undefined)
    patch.is_monotributo = rest.is_monotributo;
  if (rest.hire_date !== undefined) patch.hire_date = rest.hire_date;
  if (rest.notes !== undefined) patch.notes = rest.notes ?? null;
  if (rest.convenio !== undefined) patch.convenio = rest.convenio ?? null;
  if (rest.categoria !== undefined) patch.categoria = rest.categoria ?? null;
  if (rest.obra_social !== undefined)
    patch.obra_social = rest.obra_social ?? null;
  if (rest.art !== undefined) patch.art = rest.art ?? null;
  if (rest.retribucion_formal !== undefined)
    patch.retribucion_formal = rest.retribucion_formal ?? null;
  return patch;
}

/**
 * "Editar empleado": the employee and its driver record, which follows it,
 * in one transaction (RPC `update_employee`), with the caller's session,
 * then the audit (a salary change on its own event: the most sensitive
 * field). Only a change away from the driver position deactivates the
 * record: rows saved before the positions list (free text) keep their
 * driver. The caller has already checked `hr:write` and parsed the input
 * with `EmployeeUpdateSchema`: the employee form and an accepted assistant
 * proposal.
 */
export async function updateEmployee(
  actorId: string,
  input: EmployeeUpdateInput,
): Promise<ActionResult> {
  const { id, ...rest } = input;
  const patch = employeePatch(rest);
  const driver = driverRecordPatch(rest);
  if (Object.keys(patch).length === 0 && Object.keys(driver).length === 0) {
    return { ok: true, data: undefined };
  }

  const supabase = await createClient();
  const { data: previous, error } = await supabase.rpc("update_employee", {
    p_id: id,
    p_patch: patch,
    p_driver_position: DRIVER_POSITION,
    p_driver: driver,
  });
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "employees.update.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("employees.update.failed", { userId: actorId, id, error });
    return { ok: false, error: "No se pudo actualizar el empleado." };
  }
  const before = PreviousEmployeeSchema.safeParse(previous);
  if (!before.success) {
    return { ok: false, error: "El empleado no existe." };
  }

  if (
    rest.base_salary !== undefined &&
    Number(before.data.base_salary ?? 0) !== Number(rest.base_salary ?? 0)
  ) {
    await logAudit(
      "employee.salary_changed",
      actorId,
      {
        legal_name: before.data.legal_name,
        from: before.data.base_salary,
        to: rest.base_salary,
      },
      id,
    );
  } else {
    await logAudit(
      "employee.updated",
      actorId,
      { fields: Object.keys(patch) },
      id,
    );
  }
  return { ok: true, data: undefined };
}
