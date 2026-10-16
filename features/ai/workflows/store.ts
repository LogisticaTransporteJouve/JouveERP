import "server-only";

import { PG_CHECK_VIOLATION } from "@/lib/db/pg-error-codes";
import { getServiceClient } from "@/lib/supabase/service";

import { nextRunAt } from "./schedule";
import {
  WORKFLOW_CADENCES,
  draftSchedule,
  type AiWorkflowDraft,
  type WorkflowCadence,
  type WorkflowSchedule,
} from "./schema";

// The service client bypasses RLS: every function here filters by the user id
// its caller passes, and callers pass the id of a gated session
// (requireUserContext + userCan) or of the run's own row.

/** Bounds the background spend one user can schedule. */
export const MAX_ACTIVE_WORKFLOWS_PER_USER = 10;

const WORKFLOW_COLUMNS =
  "id, title, prompt, cadence, run_hour, run_minute, weekday, month_day, is_active, next_run_at, created_at";

const RUN_COLUMNS =
  "id, workflow_id, scheduled_for, status, output, summary, skip_reason, error, started_at, finished_at";

export type AiWorkflowRow = {
  id: string;
  title: string;
  prompt: string;
  schedule: WorkflowSchedule;
  isActive: boolean;
  nextRunAt: string;
  createdAt: string;
};

export type AiWorkflowRunRow = {
  id: string;
  workflowId: string;
  scheduledFor: string;
  status: string;
  output: string | null;
  summary: string | null;
  skipReason: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type WorkflowDbRow = {
  id: string;
  title: string;
  prompt: string;
  cadence: string;
  run_hour: number;
  run_minute: number;
  weekday: number | null;
  month_day: number | null;
  is_active: boolean;
  next_run_at: string;
  created_at: string;
};

type RunDbRow = {
  id: string;
  workflow_id: string;
  scheduled_for: string;
  status: string;
  output: string | null;
  summary: string | null;
  skip_reason: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

function toCadence(value: string): WorkflowCadence {
  return WORKFLOW_CADENCES.find((c) => c === value) ?? "daily";
}

export function scheduleOf(row: {
  cadence: string;
  run_hour: number;
  run_minute: number;
  weekday: number | null;
  month_day: number | null;
}): WorkflowSchedule {
  return {
    cadence: toCadence(row.cadence),
    runHour: row.run_hour,
    runMinute: row.run_minute,
    weekday: row.weekday,
    monthDay: row.month_day,
  };
}

function toWorkflow(row: WorkflowDbRow): AiWorkflowRow {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    schedule: scheduleOf(row),
    isActive: row.is_active,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  };
}

export function toRun(row: RunDbRow): AiWorkflowRunRow {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    scheduledFor: row.scheduled_for,
    status: row.status,
    output: row.output,
    summary: row.summary,
    skipReason: row.skip_reason,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class WorkflowLimitError extends Error {
  constructor() {
    super(
      `Llegaste al máximo de ${MAX_ACTIVE_WORKFLOWS_PER_USER} tareas activas. Pausá o borrá alguna.`,
    );
  }
}

/** The active-task cap is enforced by a trigger under a per-user lock
 *  (ai_workflows_enforce_active_cap), so concurrent creates or resumes
 *  cannot both pass it; this maps its refusal. */
function throwWorkflowError(error: { code?: string; message?: string }): never {
  if (
    error.code === PG_CHECK_VIOLATION &&
    (error.message ?? "").includes("ai_workflows: active limit")
  ) {
    throw new WorkflowLimitError();
  }
  throw error;
}

export async function listWorkflows(userId: string): Promise<AiWorkflowRow[]> {
  const { data, error } = await getServiceClient()
    .from("ai_workflows")
    .select(WORKFLOW_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toWorkflow);
}

/** Creates the task with its first occurrence after `now`. */
export async function createWorkflow(
  userId: string,
  draft: AiWorkflowDraft,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const service = getServiceClient();
  const schedule = draftSchedule(draft);
  const { data, error } = await service
    .from("ai_workflows")
    .insert({
      user_id: userId,
      title: draft.title,
      prompt: draft.prompt,
      cadence: schedule.cadence,
      run_hour: schedule.runHour,
      run_minute: schedule.runMinute,
      weekday: schedule.weekday,
      month_day: schedule.monthDay,
      next_run_at: nextRunAt(schedule, now).toISOString(),
    })
    .select("id")
    .single();
  if (error) throwWorkflowError(error);
  return { id: data.id };
}

/** Pauses or resumes; resuming schedules the next occurrence after `now`, so
 *  occurrences missed while paused never run. False when it is not the
 *  user's task. */
export async function setWorkflowActive(
  userId: string,
  id: string,
  active: boolean,
  now: Date = new Date(),
): Promise<boolean> {
  const service = getServiceClient();
  const { data: row, error } = await service
    .from("ai_workflows")
    .select("cadence, run_hour, run_minute, weekday, month_day")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return false;
  const { data, error: updateError } = await service
    .from("ai_workflows")
    .update(
      active
        ? {
            is_active: true,
            next_run_at: nextRunAt(scheduleOf(row), now).toISOString(),
          }
        : { is_active: false },
    )
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (updateError) throwWorkflowError(updateError);
  return (data?.length ?? 0) > 0;
}

/** Deletes the task and its runs. False when it is not the user's task. */
export async function deleteWorkflow(
  userId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("ai_workflows")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export const RUN_HISTORY_LIMIT = 30;

/** The task's latest runs, newest first. Empty when it is not the user's. */
export async function listRuns(
  userId: string,
  workflowId: string,
): Promise<AiWorkflowRunRow[]> {
  const { data, error } = await getServiceClient()
    .from("ai_workflow_runs")
    .select(RUN_COLUMNS)
    .eq("workflow_id", workflowId)
    .eq("user_id", userId)
    .order("scheduled_for", { ascending: false })
    .limit(RUN_HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []).map(toRun);
}
