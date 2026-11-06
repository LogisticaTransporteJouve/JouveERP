"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { createEmployee } from "@/lib/commands/create-employee";
import { updateEmployee } from "@/lib/commands/update-employee";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  readEmployeeDriver,
  type EmployeeDriver,
} from "../lib/employee-driver";
import { paginateRange } from "@/lib/supabase/paginate";

import {
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
  return createEmployee(ctx, parsed.data);
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
  return updateEmployee(ctx.userId, parsed.data);
}

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
