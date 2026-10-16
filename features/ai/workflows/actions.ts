"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

import {
  AiWorkflowDraftSchema,
  SetWorkflowActiveSchema,
  WorkflowIdSchema,
} from "./schema";
import {
  WorkflowLimitError,
  createWorkflow,
  deleteWorkflow,
  listRuns,
  listWorkflows,
  setWorkflowActive,
  type AiWorkflowRow,
  type AiWorkflowRunRow,
} from "./store";

const DENIED = "No tenés permiso para las tareas de IA.";

/** The caller's own tasks (ai:chat). */
export async function listAiWorkflowsAction(): Promise<
  ActionResult<AiWorkflowRow[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) return { ok: false, error: DENIED };
  try {
    return { ok: true, data: await listWorkflows(ctx.userId) };
  } catch (error) {
    logger.error("ai.workflows.list_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las tareas." };
  }
}

/** Creates a task from the dialog (ai:chat). The assistant's proposal card
 *  reaches the same store after its own confirm gate. */
export async function createAiWorkflowAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) return { ok: false, error: DENIED };
  const parsed = AiWorkflowDraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  try {
    const created = await createWorkflow(ctx.userId, parsed.data);
    await logAudit(
      "ai.workflow.created",
      ctx.userId,
      { cadence: parsed.data.cadence, origin: "dialog" },
      created.id,
    );
    return { ok: true, data: created };
  } catch (error) {
    if (error instanceof WorkflowLimitError) {
      return { ok: false, error: error.message };
    }
    logger.error("ai.workflows.create_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear la tarea." };
  }
}

/** Pauses or resumes one of the caller's tasks (ai:chat). */
export async function setAiWorkflowActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) return { ok: false, error: DENIED };
  const parsed = SetWorkflowActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  try {
    const done = await setWorkflowActive(
      ctx.userId,
      parsed.data.id,
      parsed.data.active,
    );
    if (!done) return { ok: false, error: "No se encontró la tarea." };
    await logAudit(
      parsed.data.active ? "ai.workflow.resumed" : "ai.workflow.paused",
      ctx.userId,
      {},
      parsed.data.id,
    );
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof WorkflowLimitError) {
      return { ok: false, error: error.message };
    }
    logger.error("ai.workflows.set_active_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la tarea." };
  }
}

/** Deletes one of the caller's tasks and its runs (ai:chat). */
export async function deleteAiWorkflowAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) return { ok: false, error: DENIED };
  const parsed = WorkflowIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  try {
    const done = await deleteWorkflow(ctx.userId, parsed.data.id);
    if (!done) return { ok: false, error: "No se encontró la tarea." };
    await logAudit("ai.workflow.deleted", ctx.userId, {}, parsed.data.id);
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("ai.workflows.delete_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la tarea." };
  }
}

/** Run history of one of the caller's tasks (ai:chat). */
export async function listAiWorkflowRunsAction(
  input: unknown,
): Promise<ActionResult<AiWorkflowRunRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) return { ok: false, error: DENIED };
  const parsed = WorkflowIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  try {
    return { ok: true, data: await listRuns(ctx.userId, parsed.data.id) };
  } catch (error) {
    logger.error("ai.workflows.runs_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las corridas." };
  }
}
