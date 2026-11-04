import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

import { nextRunAt } from "./schedule";
import type { WorkflowSchedule } from "./schema";
import { scheduleOf } from "./store";

// Run lifecycle for the Inngest functions (service client, no user session):
// every write is a compare-and-set on `status`, so a retried step or a second
// delivery of the same event never runs or finishes a run twice.

/** Workflows (and queued runs) one reconcile pass handles. */
export const RECONCILE_BATCH = 200;

/** Runs queued longer ago than this are not re-sent (Inngest dedupes event
 *  ids for 24 hours). */
const RESEND_WINDOW_MS = 23 * 60 * 60 * 1000;

const SCHEDULE_COLUMNS =
  "id, user_id, cadence, run_hour, run_minute, weekday, month_day, is_active, next_run_at, updated_at";

/** What the scheduler needs of a task. `version` is its `updated_at`: every
 *  write moves it (set_updated_at trigger). */
export type ScheduledWorkflow = {
  id: string;
  userId: string;
  schedule: WorkflowSchedule;
  isActive: boolean;
  nextRunAt: string;
  version: string;
};

type ScheduleDbRow = {
  id: string;
  user_id: string;
  cadence: string;
  run_hour: number;
  run_minute: number;
  weekday: number | null;
  month_day: number | null;
  is_active: boolean;
  next_run_at: string;
  updated_at: string;
};

function toScheduled(row: ScheduleDbRow): ScheduledWorkflow {
  return {
    id: row.id,
    userId: row.user_id,
    schedule: scheduleOf(row),
    isActive: row.is_active,
    nextRunAt: row.next_run_at,
    version: row.updated_at,
  };
}

export async function loadScheduledWorkflow(
  id: string,
): Promise<ScheduledWorkflow | null> {
  const { data, error } = await getServiceClient()
    .from("ai_workflows")
    .select(SCHEDULE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toScheduled(data) : null;
}

/**
 * Why a scheduler that slept until `expected.nextRunAt` must not run, or null
 * when the task still is what it was scheduled as. Backs up `cancelOn`: a
 * change whose cancel event was lost still stops the old schedule.
 */
export function staleReason(
  workflow: ScheduledWorkflow | null,
  expected: { nextRunAt: string; version: string },
): "deleted" | "paused" | "changed" | null {
  if (!workflow) return "deleted";
  if (!workflow.isActive) return "paused";
  if (
    workflow.version !== expected.version ||
    Date.parse(workflow.nextRunAt) !== Date.parse(expected.nextRunAt)
  ) {
    return "changed";
  }
  return null;
}

export type QueuedRun = { runId: string; userId: string };

export type QueuedOccurrence = {
  /** The run to send, while it is still queued. */
  run: QueuedRun | null;
  /** What to schedule next; null when another writer moved the task. */
  next: { nextRunAt: string; version: string } | null;
};

/**
 * Queues the run of the occurrence `workflow` is due at and advances the task
 * to its first occurrence after `now`, so occurrences missed while nothing ran
 * collapse into this one. Idempotent: the run insert ignores an existing
 * (workflow_id, scheduled_for); the advance is a compare-and-set on
 * `next_run_at`, and when it finds the task already advanced to the same next
 * occurrence (a retried step, or a twin scheduler) it hands back that version,
 * whose event id dedupes.
 */
export async function queueOccurrence(
  workflow: ScheduledWorkflow,
  now: Date,
): Promise<QueuedOccurrence> {
  const service = getServiceClient();
  const scheduledFor = new Date(workflow.nextRunAt).toISOString();
  const nextAt = nextRunAt(workflow.schedule, now).toISOString();

  const previous = await latestSucceededRunId(workflow.id);
  const { error: insertError } = await service.from("ai_workflow_runs").upsert(
    {
      workflow_id: workflow.id,
      user_id: workflow.userId,
      scheduled_for: scheduledFor,
      previous_run_id: previous,
    },
    { onConflict: "workflow_id,scheduled_for", ignoreDuplicates: true },
  );
  if (insertError) throw insertError;
  const { data: run, error: runError } = await service
    .from("ai_workflow_runs")
    .select("id, user_id, status")
    .eq("workflow_id", workflow.id)
    .eq("scheduled_for", scheduledFor)
    .maybeSingle();
  if (runError) throw runError;

  const { data: advanced, error: advanceError } = await service
    .from("ai_workflows")
    .update({ next_run_at: nextAt })
    .eq("id", workflow.id)
    .eq("is_active", true)
    .eq("next_run_at", scheduledFor)
    .select("next_run_at, updated_at");
  if (advanceError) throw advanceError;

  let next: QueuedOccurrence["next"] = null;
  const row = advanced?.[0];
  if (row) {
    next = { nextRunAt: row.next_run_at, version: row.updated_at };
  } else {
    const current = await loadScheduledWorkflow(workflow.id);
    if (
      current?.isActive &&
      Date.parse(current.nextRunAt) === Date.parse(nextAt)
    ) {
      next = { nextRunAt: current.nextRunAt, version: current.version };
    }
  }

  return {
    run:
      run && run.status === "queued"
        ? { runId: run.id, userId: run.user_id }
        : null,
    next,
  };
}

/**
 * Active tasks due before `until` (the past included), for the daily
 * reconcile to schedule again. A task whose scheduler is alive gets the same
 * event id it already has (deduped when sent in the last 24 hours) or a twin
 * that the compare-and-set in queueOccurrence resolves.
 */
export async function listWorkflowsToSchedule(
  until: Date,
): Promise<ScheduledWorkflow[]> {
  const { data, error } = await getServiceClient()
    .from("ai_workflows")
    .select(SCHEDULE_COLUMNS)
    .eq("is_active", true)
    .lte("next_run_at", until.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(RECONCILE_BATCH);
  if (error) throw error;
  return (data ?? []).map(toScheduled);
}

/**
 * Closes runs left queued past the re-send window and returns the recent
 * queued ones, for the reconcile to send again (their event id is the run id,
 * so a run whose event did arrive is not started twice).
 */
export async function expireAndListQueuedRuns(now: Date): Promise<QueuedRun[]> {
  const service = getServiceClient();
  // Measured from when the run was queued, not from its occurrence, so the
  // catch-up run of a long outage (an old scheduled_for, queued just now)
  // still runs.
  const resendFrom = new Date(now.getTime() - RESEND_WINDOW_MS).toISOString();
  const { error: expireError } = await service
    .from("ai_workflow_runs")
    .update({
      status: "skipped",
      skip_reason: "expired",
      finished_at: now.toISOString(),
    })
    .eq("status", "queued")
    .lt("created_at", resendFrom);
  if (expireError) throw expireError;

  const { data: queued, error: queuedError } = await service
    .from("ai_workflow_runs")
    .select("id, user_id")
    .eq("status", "queued")
    .gte("created_at", resendFrom)
    .order("scheduled_for", { ascending: true })
    .limit(RECONCILE_BATCH);
  if (queuedError) throw queuedError;
  return (queued ?? []).map((r) => ({ runId: r.id, userId: r.user_id }));
}

async function latestSucceededRunId(
  workflowId: string,
): Promise<string | null> {
  const { data, error } = await getServiceClient()
    .from("ai_workflow_runs")
    .select("id")
    .eq("workflow_id", workflowId)
    .eq("status", "succeeded")
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export type RunToExecute = {
  runId: string;
  status: string;
  userId: string;
  scheduledFor: string;
  previousRunId: string | null;
  workflow: { id: string; title: string; prompt: string; isActive: boolean };
};

/** The run and its workflow; null when either is gone (deleted task). */
export async function loadRun(runId: string): Promise<RunToExecute | null> {
  const service = getServiceClient();
  const { data: run, error } = await service
    .from("ai_workflow_runs")
    .select("id, status, user_id, workflow_id, scheduled_for, previous_run_id")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  if (!run) return null;
  const { data: workflow, error: wfError } = await service
    .from("ai_workflows")
    .select("id, title, prompt, is_active")
    .eq("id", run.workflow_id)
    .eq("user_id", run.user_id)
    .maybeSingle();
  if (wfError) throw wfError;
  if (!workflow) return null;
  return {
    runId: run.id,
    status: run.status,
    userId: run.user_id,
    scheduledFor: run.scheduled_for,
    previousRunId: run.previous_run_id,
    workflow: {
      id: workflow.id,
      title: workflow.title,
      prompt: workflow.prompt,
      isActive: workflow.is_active,
    },
  };
}

async function transition(
  runId: string,
  from: readonly string[],
  patch: {
    status: string;
    started_at?: string;
    finished_at?: string;
    output?: string;
    summary?: string;
    skip_reason?: string;
    error?: string;
    tool_names?: string[];
  },
): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("ai_workflow_runs")
    .update(patch)
    .eq("id", runId)
    .in("status", [...from])
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export function claimRun(runId: string, now: Date): Promise<boolean> {
  return transition(runId, ["queued"], {
    status: "running",
    started_at: now.toISOString(),
  });
}

/** Closes a run that will not execute: from `queued` at claim time, or from
 *  `running` when the user lost access before a retried execute step. */
export function skipRun(
  runId: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  return transition(runId, ["queued", "running"], {
    status: "skipped",
    skip_reason: reason,
    finished_at: now.toISOString(),
  });
}

export function completeRun(
  runId: string,
  result: { output: string; summary: string; toolNames: string[] },
  now: Date,
): Promise<boolean> {
  return transition(runId, ["running"], {
    status: "succeeded",
    output: result.output,
    summary: result.summary,
    tool_names: result.toolNames,
    finished_at: now.toISOString(),
  });
}

export function failRun(
  runId: string,
  message: string,
  now: Date,
): Promise<boolean> {
  return transition(runId, ["queued", "running"], {
    status: "failed",
    error: message.slice(0, 500),
    finished_at: now.toISOString(),
  });
}
