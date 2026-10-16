import "server-only";

import type { CreateLeaveInput } from "@/features/hr/vacation-schema";
import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Inserts an employee leave with the caller's session (RLS applies) and audits
 * it. The caller has already checked `hr:write` and parsed the input with
 * `CreateLeaveSchema`: the leaves dialog and a confirmed assistant proposal.
 */
export async function createLeave(
  actorId: string,
  input: CreateLeaveInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_leaves")
    .insert({
      employee_id: input.employee_id,
      start_date: input.start_date,
      end_date: input.end_date,
      kind: input.kind,
      notes: input.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "No se pudo crear." };
  }
  await logAudit(
    "leave.created",
    actorId,
    {
      employee_id: input.employee_id,
      kind: input.kind,
      start_date: input.start_date,
      end_date: input.end_date,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
