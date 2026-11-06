import "server-only";

import type { z } from "zod";

import { assigneesError } from "@/features/tasks/lib/assignees";
import type { TaskCreateSchema } from "@/features/tasks/schema";
import { logAudit } from "@/lib/actions/audit";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Creates a manual task with its assignees and audits it. The caller has
 * already checked `tasks:write` and parsed the input with `TaskCreateSchema`:
 * the tasks dialog and an accepted assistant proposal.
 */
export async function createTask(
  actorId: string,
  input: z.output<typeof TaskCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const invalid = await assigneesError(input.assignee_ids);
  if (invalid) return { ok: false, error: invalid };

  // The task and its assignees in one transaction.
  const { data: id, error } = await getServiceClient().rpc("create_task", {
    p_actor: actorId,
    p_title: input.title,
    p_description: input.description ?? undefined,
    p_due_date: input.due_date ?? undefined,
    p_assignee_ids: input.assignee_ids,
  });
  if (error || !id) {
    logger.error("tasks.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo crear la tarea." };
  }

  await logAudit(
    "task.created",
    actorId,
    {
      title: input.title,
      due_date: input.due_date,
      assignee_ids: input.assignee_ids,
    },
    id,
  );
  return { ok: true, data: { id } };
}
