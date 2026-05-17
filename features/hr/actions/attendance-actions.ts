"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  DeleteAttendanceSchema,
  isAttendanceKind,
  UpsertAttendanceSchema,
  type AttendanceRecord,
  type Holiday,
} from "../attendance-schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
    logger.error("audit.insert.failed", { userId: actorId, eventType, targetResourceId, error });
  }
}

function narrowAttendance(row: {
  kind: string;
  source: string;
  [key: string]: unknown;
}): AttendanceRecord | null {
  if (!isAttendanceKind(row.kind)) {
    logger.error("attendance.unknown_kind", { value: row.kind });
    return null;
  }
  if (
    row.source !== "manual" &&
    row.source !== "leave_sync" &&
    row.source !== "holiday_sync"
  ) {
    logger.error("attendance.unknown_source", { value: row.source });
    return null;
  }
  return row as AttendanceRecord;
}

const COLS =
  "id, employee_id, date, kind, hours_lost, notes, source, created_by, created_at, updated_at";

export type AttendanceMonthData = {
  year: number;
  month: number;
  records: AttendanceRecord[];
  holidays: Holiday[];
};

export async function getAttendanceMonthAction(
  year: number,
  month: number,
): Promise<ActionResult<AttendanceMonthData>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver asistencia." };
  }

  // [firstOfMonth, firstOfNextMonth)
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  const supabase = await createSupabaseClient();
  const [{ data: records, error: recErr }, { data: holidays, error: holErr }] =
    await Promise.all([
      supabase
        .from("attendance_records")
        .select(COLS)
        .gte("date", start)
        .lt("date", end),
      supabase
        .from("holidays")
        .select("date, name, scope, notes, created_by, created_at")
        .gte("date", start)
        .lt("date", end),
    ]);

  if (recErr) return { ok: false, error: recErr.message };
  if (holErr) return { ok: false, error: holErr.message };

  return {
    ok: true,
    data: {
      year,
      month,
      records: (records ?? [])
        .map(narrowAttendance)
        .filter((row): row is AttendanceRecord => row !== null),
      holidays: (holidays ?? []) as Holiday[],
    },
  };
}

export async function upsertAttendanceRecordAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = UpsertAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .upsert(
      {
        employee_id: parsed.data.employee_id,
        date: parsed.data.date,
        kind: parsed.data.kind,
        hours_lost: parsed.data.hours_lost ?? null,
        notes: parsed.data.notes ?? null,
        source: "manual",
        created_by: ctx.userId,
      },
      { onConflict: "employee_id,date" },
    )
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "No se pudo guardar." };
  }
  await logAudit(
    "attendance.upserted",
    ctx.userId,
    {
      employee_id: parsed.data.employee_id,
      date: parsed.data.date,
      kind: parsed.data.kind,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function deleteAttendanceRecordAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = DeleteAttendanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const supabase = await createSupabaseClient();
  // Sólo borramos rows manuales — leave_sync y holiday_sync se gestionan
  // desde sus tablas de origen.
  const { error } = await supabase
    .from("attendance_records")
    .delete()
    .eq("id", parsed.data.id)
    .eq("source", "manual");

  if (error) return { ok: false, error: error.message };
  await logAudit("attendance.deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

// Lista de employees activos al inicio del mes (para los headers del grid).
export type AttendanceEmployee = {
  id: string;
  legal_name: string;
  pay_frequency: string;
};

export async function listAttendanceEmployeesAction(): Promise<
  ActionResult<AttendanceEmployee[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, legal_name, pay_frequency")
    .eq("is_active", true)
    .order("legal_name");

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as AttendanceEmployee[] };
}
