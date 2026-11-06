import "server-only";

import type { UpsertAttendanceInput } from "@/features/hr/attendance-schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Loads one employee's attendance for a day by hand (one row per employee
 * and day: a second load replaces the manual one), with the caller's
 * session, then the audit. A day synced from a leave or a holiday is not
 * overwritten: the guard on attendance_records refuses it (it is changed
 * from its source). The caller has already checked `hr:write` and parsed
 * the input with `UpsertAttendanceSchema`: the attendance grid and an
 * accepted assistant proposal.
 */
export async function upsertAttendance(
  actorId: string,
  input: UpsertAttendanceInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .upsert(
      {
        employee_id: input.employee_id,
        date: input.date,
        kind: input.kind,
        hours_lost: input.hours_lost ?? null,
        notes: input.notes ?? null,
        source: "manual",
        created_by: actorId,
      },
      { onConflict: "employee_id,date" },
    )
    .select("id")
    .single();

  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "attendance.upsert.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("attendance.upsert.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo guardar la asistencia." };
  }
  await logAudit(
    "attendance.upserted",
    actorId,
    { employee_id: input.employee_id, date: input.date, kind: input.kind },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
