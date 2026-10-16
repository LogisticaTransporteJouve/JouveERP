import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

import {
  EARLIER_OUTPUT_CHAR_CAP,
  MEMORY_INDEX_RUNS,
  capText,
  renderRunMemory,
  type RememberedRun,
  type RunMemory,
} from "./memory";

// Service client, so every read filters by the run's own user and workflow:
// a run only ever remembers runs of its own task.

const MEMORY_COLUMNS = "id, scheduled_for, summary, output";

/** The previous run (fixed when this run was queued) and the older
 *  succeeded runs before it; null when there is none to remember. */
export async function loadRunMemory(
  userId: string,
  workflowId: string,
  previousRunId: string | null,
): Promise<RunMemory | null> {
  if (!previousRunId) return null;
  const service = getServiceClient();
  const { data: previous, error } = await service
    .from("ai_workflow_runs")
    .select(MEMORY_COLUMNS)
    .eq("id", previousRunId)
    .eq("workflow_id", workflowId)
    .eq("user_id", userId)
    .eq("status", "succeeded")
    .maybeSingle();
  if (error) throw error;
  if (!previous) return null;

  // Older runs are listed by summary only; openEarlierRun reads an answer.
  const { data: earlier, error: earlierError } = await service
    .from("ai_workflow_runs")
    .select("id, scheduled_for, summary")
    .eq("workflow_id", workflowId)
    .eq("user_id", userId)
    .eq("status", "succeeded")
    .lt("scheduled_for", previous.scheduled_for)
    .order("scheduled_for", { ascending: false })
    .limit(MEMORY_INDEX_RUNS);
  if (earlierError) throw earlierError;

  const toRemembered = (r: {
    id: string;
    scheduled_for: string;
    summary: string | null;
    output?: string | null;
  }): RememberedRun => ({
    id: r.id,
    scheduledFor: r.scheduled_for,
    summary: r.summary,
    output: r.output ?? null,
  });
  return renderRunMemory(
    toRemembered(previous),
    (earlier ?? []).map(toRemembered),
  );
}

/** An earlier run's answer for `openEarlierRun`; null unless it is a
 *  succeeded run of this user's task. */
export async function loadEarlierRunOutput(
  userId: string,
  workflowId: string,
  runId: string,
): Promise<{ id: string; scheduledFor: string; output: string } | null> {
  const { data, error } = await getServiceClient()
    .from("ai_workflow_runs")
    .select("id, scheduled_for, output")
    .eq("id", runId)
    .eq("workflow_id", workflowId)
    .eq("user_id", userId)
    .eq("status", "succeeded")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    scheduledFor: data.scheduled_for,
    output: capText(data.output ?? "", EARLIER_OUTPUT_CHAR_CAP),
  };
}
