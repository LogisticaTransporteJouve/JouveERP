"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { assigneesError } from "../lib/assignees";
import {
  RecurringTaskCreateSchema,
  RecurringTaskUpdateSchema,
  type RecurringTask,
} from "../schema";

export async function listRecurringTasksAction(): Promise<
  ActionResult<RecurringTask[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:read")) {
    return { ok: false, error: "No tenés permiso para ver tareas." };
  }
  const { data, error } = await getServiceClient()
    .from("recurring_tasks")
    .select(
      "id, title, description, day_of_month, is_active, assignees:recurring_task_assignees(user_id)",
    )
    .order("is_active", { ascending: false })
    .order("day_of_month")
    .order("title");
  if (error) {
    logger.error("recurring_tasks.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las recurrentes." };
  }
  return {
    ok: true,
    data: (data ?? []).map(({ assignees, ...row }) => ({
      ...row,
      assignee_ids: assignees.map((a) => a.user_id),
    })),
  };
}

/** Creates this month's occurrence right away when it is already due within
 *  the cron's window; the daily cron does the rest. Failure only waits for
 *  the next run. */
async function materializeNow(userId: string): Promise<void> {
  const { error } = await getServiceClient().rpc(
    "materialize_recurring_tasks",
    { p_today: todayInAR() },
  );
  if (error) {
    logger.warn("recurring_tasks.materialize.failed", { userId, error });
  }
}

export async function createRecurringTaskAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:write")) {
    return { ok: false, error: "No tenés permiso para crear tareas." };
  }
  const parsed = RecurringTaskCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const invalid = await assigneesError(parsed.data.assignee_ids);
  if (invalid) return { ok: false, error: invalid };

  const service = getServiceClient();
  const { data, error } = await service
    .from("recurring_tasks")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description,
      day_of_month: parsed.data.day_of_month,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("recurring_tasks.create.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo crear la tarea recurrente." };
  }

  if (parsed.data.assignee_ids.length > 0) {
    const { error: assignError } = await service
      .from("recurring_task_assignees")
      .insert(
        parsed.data.assignee_ids.map((user_id) => ({
          recurring_task_id: data.id,
          user_id,
        })),
      );
    if (assignError) {
      // No occurrence exists yet: take the recurrence back.
      await service.from("recurring_tasks").delete().eq("id", data.id);
      logger.error("recurring_tasks.create.assign_failed", {
        userId: ctx.userId,
        error: assignError,
      });
      return { ok: false, error: "No se pudo crear la tarea recurrente." };
    }
  }

  await logAudit(
    "recurring_task.created",
    ctx.userId,
    {
      title: parsed.data.title,
      day_of_month: parsed.data.day_of_month,
      assignee_ids: parsed.data.assignee_ids,
    },
    data.id,
  );
  await materializeNow(ctx.userId);
  return { ok: true, data: { id: data.id } };
}

/** Changes apply to the occurrences still to come; created ones keep theirs. */
export async function updateRecurringTaskAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:write")) {
    return { ok: false, error: "No tenés permiso para editar tareas." };
  }
  const parsed = RecurringTaskUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, assignee_ids, ...fields } = parsed.data;
  if (assignee_ids) {
    const invalid = await assigneesError(assignee_ids);
    if (invalid) return { ok: false, error: invalid };
  }

  const service = getServiceClient();
  const { data, error } = await service
    .from("recurring_tasks")
    .update({
      ...(fields.title !== undefined && { title: fields.title }),
      ...(fields.description !== undefined && {
        description: fields.description,
      }),
      ...(fields.day_of_month !== undefined && {
        day_of_month: fields.day_of_month,
      }),
      ...(fields.is_active !== undefined && { is_active: fields.is_active }),
    })
    .eq("id", id)
    .select("id");
  if (error) {
    logger.error("recurring_tasks.update.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo guardar la tarea recurrente." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "La tarea recurrente no existe." };
  }

  if (assignee_ids) {
    const { error: clearError } = await service
      .from("recurring_task_assignees")
      .delete()
      .eq("recurring_task_id", id);
    const { error: assignError } = clearError
      ? { error: clearError }
      : assignee_ids.length > 0
        ? await service.from("recurring_task_assignees").insert(
            assignee_ids.map((user_id) => ({
              recurring_task_id: id,
              user_id,
            })),
          )
        : { error: null };
    if (assignError) {
      logger.error("recurring_tasks.assignees.failed", {
        userId: ctx.userId,
        error: assignError,
      });
      return {
        ok: false,
        error: "Se guardó la tarea pero no sus responsables. Reintentá.",
      };
    }
  }

  await logAudit(
    "recurring_task.updated",
    ctx.userId,
    {
      fields: Object.keys(fields),
      ...(assignee_ids ? { assignee_ids } : {}),
    },
    id,
  );
  if (fields.is_active !== false) await materializeNow(ctx.userId);
  return { ok: true, data: undefined };
}
