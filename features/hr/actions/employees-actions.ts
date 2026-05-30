"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  EmployeeCreateSchema,
  EmployeeReactivateSchema,
  EmployeeTerminateSchema,
  EmployeeUpdateSchema,
  isPayFrequency,
  type Employee,
} from "../schema";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    event_type: eventType,
    target_resource_id: targetResourceId ?? null,
    payload,
  });
  if (error) {
    logger.error("audit.insert.failed", {
      userId: actorId,
      eventType,
      targetResourceId,
      error,
    });
  }
}

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
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "No tenés permiso para ver empleados." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employees")
    .select(SELECT_COLS)
    .order("legal_name");

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
  if (!userCan(ctx.roles, "hr:read")) {
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
  if (!userCan(ctx.roles, "hr:read")) {
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
  if (!userCan(ctx.roles, "hr:write")) {
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
  return { ok: true, data: { id: data.id } };
}

export async function updateEmployeeAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "No tenés permiso para editar empleados." };
  }

  const parsed = EmployeeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const { id, ...rest } = parsed.data;

  // Audit: para detectar cambio sensible de sueldo, leemos el viejo primero.
  const supabase = await createSupabaseClient();
  const { data: previous, error: prevErr } = await supabase
    .from("employees")
    .select("base_salary, legal_name")
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

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: undefined };
  }

  const { error } = await supabase.from("employees").update(patch).eq("id", id);

  if (error) {
    logger.error("employees.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el empleado." };
  }

  // Audit granular: sueldo es el campo más sensible.
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
  if (!userCan(ctx.roles, "hr:write")) {
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
      // Notes acumulables: si el caller mandó algo, lo concatena; si no, deja
      // las viejas. La concatenación se hace en el cliente para no perder
      // historial silenciosamente.
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
  return { ok: true, data: undefined };
}

export async function reactivateEmployeeAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
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
