"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { todayInAR } from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  deactivateEmployeeDriver,
  readEmployeeDriver,
  syncEmployeeDriver,
  type EmployeeDriver,
} from "../lib/employee-driver";
import { applyVacationOpening } from "../lib/vacation-opening";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  EmployeeCreateSchema,
  isDriverPosition,
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
  "id, legal_name, position, cuil, cbu, pay_frequency, base_salary, viatico_monthly, is_monotributo, hire_date, termination_date, notes, is_active, created_by, created_at, updated_at";

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

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employees")
    .insert({
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
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
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
    data.id,
  );

  // A driver position creates the employee's driver record (Flota → Choferes).
  if (isDriverPosition(parsed.data.position)) {
    const driver = await syncEmployeeDriver({
      employeeId: data.id,
      fullName: parsed.data.legal_name,
      cuil: parsed.data.cuil ?? null,
      isDriver: true,
      licenseNumber: parsed.data.license_number ?? null,
      licenseCategory: parsed.data.license_category ?? null,
      phone: parsed.data.driver_phone ?? null,
      userId: ctx.userId,
    });
    if (!driver.ok) {
      logger.warn("employees.create.driver_failed", {
        userId: ctx.userId,
        employeeId: data.id,
      });
      return {
        ok: false,
        error: `El empleado se creó, pero no su ficha de chofer: ${driver.error} Guardalo de nuevo desde su ficha.`,
      };
    }
  }

  // Vacation days loaded with the employee (owner/admin only, like the
  // balances' RLS). The employee already exists, so a failure here is
  // reported but does not undo it: the days can be loaded again from the
  // employee's page.
  const currentDays = parsed.data.vacation_current_days ?? null;
  const previousDays = parsed.data.vacation_previous_days ?? null;
  if (
    (currentDays !== null || previousDays !== null) &&
    userCan(ctx.access, "hr:admin")
  ) {
    const opening = await applyVacationOpening(supabase, {
      employeeId: data.id,
      currentDays,
      previousDays,
      today: todayInAR(),
      userId: ctx.userId,
    });
    if (!opening.ok) {
      logger.warn("employees.create.vacations_failed", {
        userId: ctx.userId,
        employeeId: data.id,
      });
      return {
        ok: false,
        error: `El empleado se creó, pero no se pudieron guardar las vacaciones: ${opening.error} Cargalas desde su ficha.`,
      };
    }
    await logAudit(
      "employee.vacation_balance_set",
      ctx.userId,
      {
        period_year: opening.periodYear,
        current_days: currentDays,
        previous_days: previousDays,
      },
      data.id,
    );
  }
  return { ok: true, data: { id: data.id } };
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

  // Audit: to detect a sensitive salary change, we read the old value first.
  const supabase = await createSupabaseClient();
  const { data: previous, error: prevErr } = await supabase
    .from("employees")
    .select("base_salary, legal_name, position, cuil")
    .eq("id", id)
    .maybeSingle();
  if (prevErr) {
    logger.error("employees.update.prev_fetch_failed", {
      userId: ctx.userId,
      id,
      error: prevErr,
    });
  }

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

  const driverTouched =
    rest.license_number !== undefined ||
    rest.license_category !== undefined ||
    rest.driver_phone !== undefined;
  if (Object.keys(patch).length === 0 && !driverTouched) {
    return { ok: true, data: undefined };
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("employees")
      .update(patch)
      .eq("id", id);
    if (error) {
      logger.error("employees.update.failed", {
        userId: ctx.userId,
        id,
        error,
      });
      return { ok: false, error: "No se pudo actualizar el empleado." };
    }
  }

  // The driver record follows the employee. Only a change away from the
  // driver position deactivates it: rows saved before the positions list
  // (free text) keep their driver as it is.
  if (previous) {
    const position =
      rest.position !== undefined ? (rest.position ?? null) : previous.position;
    const isDriver = isDriverPosition(position);
    const leftDriver = isDriverPosition(previous.position) && !isDriver;
    let existing: EmployeeDriver | null = null;
    try {
      existing = await readEmployeeDriver(id);
    } catch {
      existing = null;
    }
    if (isDriver || leftDriver || existing) {
      const driver = await syncEmployeeDriver({
        employeeId: id,
        fullName: rest.legal_name ?? previous.legal_name,
        cuil: rest.cuil !== undefined ? (rest.cuil ?? null) : previous.cuil,
        isDriver: isDriver || (!leftDriver && existing?.is_active === true),
        licenseNumber: rest.license_number,
        licenseCategory: rest.license_category,
        phone: rest.driver_phone,
        userId: ctx.userId,
      });
      if (!driver.ok) {
        logger.warn("employees.update.driver_failed", {
          userId: ctx.userId,
          id,
        });
        return {
          ok: false,
          error: `Se guardó el empleado, pero no su ficha de chofer: ${driver.error}`,
        };
      }
    }
  }

  // Granular audit: salary is the most sensitive field.
  if (
    previous &&
    rest.base_salary !== undefined &&
    Number(previous.base_salary ?? 0) !== Number(rest.base_salary ?? 0)
  ) {
    await logAudit(
      "employee.salary_changed",
      ctx.userId,
      {
        legal_name: previous.legal_name,
        from: previous.base_salary,
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

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("employees")
    .update({
      termination_date: parsed.data.termination_date,
      is_active: false,
      // Cumulative notes: if the caller sent something, it gets concatenated;
      // otherwise the old ones are kept. The concatenation happens on the client
      // so history isn't silently lost.
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    })
    .eq("id", parsed.data.id);

  if (error) {
    logger.error("employees.terminate.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo dar de baja al empleado." };
  }

  await logAudit(
    "employee.terminated",
    ctx.userId,
    { termination_date: parsed.data.termination_date },
    parsed.data.id,
  );

  // A terminated employee no longer drives: their driver record leaves the
  // trip pickers (history stays).
  const driverOff = await deactivateEmployeeDriver(parsed.data.id);
  if (!driverOff.ok) {
    logger.warn("employees.terminate.driver_failed", {
      userId: ctx.userId,
      id: parsed.data.id,
    });
  }
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
  const { error } = await supabase
    .from("employees")
    .update({
      termination_date: null,
      is_active: true,
    })
    .eq("id", parsed.data.id);

  if (error) {
    logger.error("employees.reactivate.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo reactivar al empleado." };
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
