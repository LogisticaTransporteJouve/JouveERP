"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { todayInAR } from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  readEmployeeDriver,
  type EmployeeDriver,
} from "../lib/employee-driver";
import { currentVacationPeriodYear } from "../lib/vacation-periods";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  DRIVER_POSITION,
  EmployeeCreateSchema,
  EmployeeReactivateSchema,
  EmployeeTerminateSchema,
  EmployeeUpdateSchema,
  isPayFrequency,
  type Employee,
} from "../schema";

function narrowEmployee(row: {
  pay_frequency: string;
  [key: string]: unknown;
}): Employee | null {
  if (!isPayFrequency(row.pay_frequency)) {
    logger.error("employees.unknown_pay_frequency", {
      value: row.pay_frequency,
    });
    return null;
  }
  return row as Employee;
}

const SELECT_COLS =
  "id, legal_name, position, cuil, cbu, pay_frequency, base_salary, viatico_monthly, is_monotributo, hire_date, termination_date, notes, is_active, created_by, created_at, updated_at, convenio, categoria, obra_social, art, retribucion_formal, trip_rate_per_day, trip_rate_per_km, trip_rate_per_unload";

// ─── List & search ───────────────────────────────────────────────────────────

export async function listEmployeesAction(): Promise<ActionResult<Employee[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "No tenés permiso para ver empleados." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("employees")
      .select(SELECT_COLS)
      .order("legal_name")
      .order("id")
      .range(from, to),
  );

  if (error) {
    logger.error("employees.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo listar los empleados." };
  }

  const items = (data ?? [])
    .map((row) => narrowEmployee(row))
    .filter((row): row is Employee => row !== null);

  return { ok: true, data: items };
}

export type EmployeeOption = {
  id: string;
  legal_name: string;
  is_active: boolean;
};

/** The employees a purchase can be charged to ("a cargo de empleado"); null
 *  when the user cannot charge one (hr:write), so the picker hides. */
export async function listEmployeeOptionsAction(): Promise<
  ActionResult<EmployeeOption[] | null>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) return { ok: true, data: null };

  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("employees")
      .select("id, legal_name, is_active")
      .order("legal_name")
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("employees.options.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo listar los empleados." };
  }
  return { ok: true, data: data ?? [] };
}

export type SearchEmployeesInput = {
  query?: string;
  onlyActive?: boolean;
  offset?: number;
  limit?: number;
};

export type SearchEmployeesPage = {
  employees: Employee[];
  nextOffset: number | null;
};

export async function searchEmployeesAction(
  input: SearchEmployeesInput = {},
): Promise<ActionResult<SearchEmployeesPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "No tenés permiso para ver empleados." };
  }

  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("search_employees", {
    p_query: (input.query ?? "").trim(),
    p_only_active: input.onlyActive ?? true,
    p_offset: offset,
    p_limit: limit + 1,
  });

  if (error) {
    logger.error("employees.search.failed", {
      userId: ctx.userId,
      query: input.query,
      error,
    });
    return { ok: false, error: "No se pudo buscar empleados." };
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const employees = rows
    .slice(0, limit)
    .map((row) => narrowEmployee(row))
    .filter((row): row is Employee => row !== null);

  return {
    ok: true,
    data: { employees, nextOffset: hasMore ? offset + limit : null },
  };
}

export async function getEmployeeByIdAction(
  id: string,
): Promise<ActionResult<Employee | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "No tenés permiso para ver empleados." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employees")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("employees.get.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo cargar el empleado." };
  }

  return { ok: true, data: data ? narrowEmployee(data) : null };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/** The driver fields of the form, only those it sent (an absent key keeps
 *  the stored value). */
function driverPayload(fields: {
  license_number?: string | null;
  license_category?: string | null;
  driver_phone?: string | null;
}): {
  license_number?: string | null;
  license_category?: string | null;
  phone?: string | null;
} {
  return {
    ...(fields.license_number !== undefined && {
      license_number: fields.license_number,
    }),
    ...(fields.license_category !== undefined && {
      license_category: fields.license_category,
    }),
    ...(fields.driver_phone !== undefined && { phone: fields.driver_phone }),
  };
}

export async function createEmployeeAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "No tenés permiso para crear empleados." };
  }

  const parsed = EmployeeCreateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  // Vacation days loaded with the employee: owner/admin only, like the
  // balances' RLS; anyone else's figures are left out.
  const loadsVacations =
    (parsed.data.vacation_current_days != null ||
      parsed.data.vacation_previous_days != null) &&
    userCan(ctx.access, "hr:admin");
  const currentDays = loadsVacations
    ? (parsed.data.vacation_current_days ?? null)
    : null;
  const previousDays = loadsVacations
    ? (parsed.data.vacation_previous_days ?? null)
    : null;
  const today = todayInAR();

  // One transaction: the employee, its driver record (a driver position,
  // Flota → Choferes) and its vacation days, or nothing.
  const supabase = await createSupabaseClient();
  const { data: id, error } = await supabase.rpc("create_employee", {
    p_employee: {
      legal_name: parsed.data.legal_name,
      position: parsed.data.position ?? null,
      cuil: parsed.data.cuil ?? null,
      cbu: parsed.data.cbu ?? null,
      pay_frequency: parsed.data.pay_frequency,
      base_salary: parsed.data.base_salary ?? null,
      viatico_monthly: parsed.data.viatico_monthly,
      is_monotributo: parsed.data.is_monotributo,
      hire_date: parsed.data.hire_date,
      notes: parsed.data.notes ?? null,
      convenio: parsed.data.convenio ?? null,
      categoria: parsed.data.categoria ?? null,
      obra_social: parsed.data.obra_social ?? null,
      art: parsed.data.art ?? null,
      retribucion_formal: parsed.data.retribucion_formal ?? null,
      created_by: ctx.userId,
    },
    p_driver_position: DRIVER_POSITION,
    p_driver: driverPayload(parsed.data),
    p_current_days: currentDays ?? undefined,
    p_previous_days: previousDays ?? undefined,
    p_today: today,
  });

  if (error || !id) {
    const guardError = mapDbGuardError(error, {
      slug: "employees.create.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("employees.create.failed", {
      userId: ctx.userId,
      legal_name: parsed.data.legal_name,
      error,
    });
    return { ok: false, error: "No se pudo crear el empleado." };
  }

  await logAudit(
    "employee.created",
    ctx.userId,
    {
      legal_name: parsed.data.legal_name,
      pay_frequency: parsed.data.pay_frequency,
      base_salary: parsed.data.base_salary ?? null,
    },
    id,
  );
  if (loadsVacations) {
    await logAudit(
      "employee.vacation_balance_set",
      ctx.userId,
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

export async function updateEmployeeAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "No tenés permiso para editar empleados." };
  }

  const parsed = EmployeeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const { id, ...rest } = parsed.data;

  type EmployeeUpdate = Database["public"]["Tables"]["employees"]["Update"];
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

  const driver = driverPayload(rest);
  if (Object.keys(patch).length === 0 && Object.keys(driver).length === 0) {
    return { ok: true, data: undefined };
  }

  // One transaction: the employee and its driver record, which follows it.
  // Only a change away from the driver position deactivates the record:
  // rows saved before the positions list (free text) keep their driver.
  const supabase = await createSupabaseClient();
  const { data: previous, error } = await supabase.rpc("update_employee", {
    p_id: id,
    p_patch: patch,
    p_driver_position: DRIVER_POSITION,
    p_driver: driver,
  });
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "employees.update.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("employees.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el empleado." };
  }
  const before = PreviousEmployeeSchema.safeParse(previous);
  if (!before.success) {
    return { ok: false, error: "El empleado no existe." };
  }

  // Granular audit: salary is the most sensitive field.
  if (
    rest.base_salary !== undefined &&
    Number(before.data.base_salary ?? 0) !== Number(rest.base_salary ?? 0)
  ) {
    await logAudit(
      "employee.salary_changed",
      ctx.userId,
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
      ctx.userId,
      { fields: Object.keys(patch) },
      id,
    );
  }

  return { ok: true, data: undefined };
}

/** What update_employee returns: the row before the edit (null: not found). */
const PreviousEmployeeSchema = z.object({
  legal_name: z.string(),
  base_salary: z.number().nullable(),
});

export async function terminateEmployeeAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "No tenés permiso para dar de baja empleados." };
  }

  const parsed = EmployeeTerminateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  // One transaction: the termination, the reason appended to the notes
  // (never replacing them) and the driver record leaving the trip pickers
  // (history stays).
  const supabase = await createSupabaseClient();
  const { data: found, error } = await supabase.rpc("terminate_employee", {
    p_id: parsed.data.id,
    p_termination_date: parsed.data.termination_date,
    p_reason: parsed.data.notes ?? undefined,
  });

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "employees.terminate.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("employees.terminate.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo dar de baja al empleado." };
  }
  if (!found) return { ok: false, error: "El empleado no existe." };

  await logAudit(
    "employee.terminated",
    ctx.userId,
    { termination_date: parsed.data.termination_date },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function reactivateEmployeeAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "No tenés permiso para reactivar empleados." };
  }

  const parsed = EmployeeReactivateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employees")
    .update({
      termination_date: null,
      is_active: true,
    })
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    logger.error("employees.reactivate.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo reactivar al empleado." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "El empleado no existe." };
  }

  await logAudit("employee.reactivated", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

/** The employee's driver data (license, phone), for the employee form. */
export async function getEmployeeDriverAction(
  employeeId: string,
): Promise<ActionResult<EmployeeDriver | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "No tenés permiso para ver empleados." };
  }
  try {
    return { ok: true, data: await readEmployeeDriver(employeeId) };
  } catch (error) {
    logger.error("employees.driver.read_failed", {
      userId: ctx.userId,
      employeeId,
      error,
    });
    return { ok: false, error: "No se pudo leer la ficha de chofer." };
  }
}
