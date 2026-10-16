import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

import { nextRunAt } from "./schedule";
import type { WorkflowSchedule } from "./schema";
import { scheduleOf } from "./store";

// Run lifecycle for the Inngest functions (service client, no user session):
// every write is a compare-and-set on `status`, so a retried step or a second
// delivery of the same event never runs or finishes a run twice.

/** Workflows claimed per cron pass; the rest wait for the next pass. */
export const MATERIALIZE_BATCH = 200;

/** Runs queued longer ago than this are not re-sent (Inngest dedupes event
 *  ids for 24 hours). */
const RESEND_WINDOW_MS = 23 * 60 * 60 * 1000;

export type DueWorkflow = {
  id: string;
  userId: string;
  schedule: WorkflowSchedule;
  nextRunAt: string;
};

export type PlannedRun = {
  workflowId: string;
  userId: string;
  /** The occurrence being run (the workflow's `next_run_at`). */
  scheduledFor: string;
  /** What `next_run_at` advances to: the first occurrence after `now`. */
  nextRunAt: string;
};

/**
 * One run per due workflow, for the occurrence it was due at, and its next
 * occurrence after `now`. A workflow that missed several occurrences (the
 * cron was down) gets a single run: the next one is computed from `now`.
 */
export function planDueRuns(
  workflows: readonly DueWorkflow[],
  now: Date,
): PlannedRun[] {
  return workflows
    .filter((w) => Date.parse(w.nextRunAt) <= now.getTime())
    .map((w) => ({
      workflowId: w.id,
      userId: w.userId,
      scheduledFor: new Date(w.nextRunAt).toISOString(),
      nextRunAt: nextRunAt(w.schedule, now).toISOString(),
    }));
}

export type QueuedRun = { runId: string; userId: string };

/**
 * Queues one run per due workflow and advances the workflow. Idempotent: the
 * run insert ignores an existing (workflow_id, scheduled_for) and the advance
 * only applies while `next_run_at` still holds the claimed occurrence. Returns
 * every recent queued run (new ones and any whose event was lost), for the
 * caller to send; event ids dedupe what was already sent.
 */
export async function materializeDueRuns(now: Date): Promise<QueuedRun[]> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("ai_workflows")
    .select(
      "id, user_id, cadence, run_hour, run_minute, weekday, month_day, next_run_at",
    )
    .eq("is_active", true)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(MATERIALIZE_BATCH);
  if (error) throw error;

  const planned = planDueRuns(
    (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      schedule: scheduleOf(row),
      nextRunAt: row.next_run_at,
    })),
    now,
  );

  for (const run of planned) {
    const previous = await latestSucceededRunId(run.workflowId);
    const { error: insertError } = await service
      .from("ai_workflow_runs")
      .upsert(
        {
          workflow_id: run.workflowId,
          user_id: run.userId,
          scheduled_for: run.scheduledFor,
          previous_run_id: previous,
        },
        { onConflict: "workflow_id,scheduled_for", ignoreDuplicates: true },
      );
    if (insertError) throw insertError;
    const { error: advanceError } = await service
      .from("ai_workflows")
      .update({ next_run_at: run.nextRunAt })
      .eq("id", run.workflowId)
      .eq("next_run_at", run.scheduledFor);
    if (advanceError) throw advanceError;
  }

  // A run still queued past the dedupe window can no longer be re-sent
  // safely: close it so it does not sit queued forever. Measured from when
  // the run was queued, not from its occurrence, so the catch-up run of a
  // long outage (an old scheduled_for, queued just now) still runs.
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
    .limit(MATERIALIZE_BATCH);
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
