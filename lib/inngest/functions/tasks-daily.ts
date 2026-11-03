import {
  buildDueNotifications,
  type DueStage,
  type DueTask,
} from "@/features/tasks/lib/notify";
import { TASK_SOURCES } from "@/features/tasks/lib/sources";
import {
  AUTOMATIC_TASK_KINDS,
  isAutomaticTaskKind,
  isTaskOrigin,
  type AutomaticTaskKind,
} from "@/features/tasks/schema";
import type { Permission } from "@/lib/auth/permissions";
import { listUserIdsWithPermission } from "@/lib/auth/users";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily Tareas job (roadmap 1.4/1.5). Each step is idempotent on its own:
//   1. materialize_recurring_tasks — the month's occurrences due within 7 days;
//   2. sync_automatic_tasks — creates, updates and closes the tasks derived
//      from documents (unique on source_table, source_id, kind);
//   3. assigns each open automatic task with no assignee to the users who
//      can act on its document (TASK_SOURCES[kind].assign plus tasks:read);
//   4. claims the due notifications (notified_stage), one step per stage,
//      and 5. inserts them:
//      'due' on the due day, 'overdue' once in the week after it. A task that
//      was already overdue for longer when it appeared is not announced.

const OVERDUE_NOTICE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function shiftIsoDate(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Users holding every one of `permissions`, per-user denies included. */
async function usersWithAll(
  permissions: readonly Permission[],
): Promise<Set<string>> {
  const lists = await Promise.all(
    permissions.map((p) => listUserIdsWithPermission(p)),
  );
  const [first = [], ...rest] = lists;
  return new Set(first.filter((id) => rest.every((l) => l.includes(id))));
}

type ClaimedRow = {
  id: string;
  title: string;
  origin: string;
  kind: string | null;
  due_date: string | null;
  assignees: { user_id: string }[];
};

function toDueTask(row: ClaimedRow, stage: DueStage): DueTask | null {
  if (!isTaskOrigin(row.origin) || !row.due_date) return null;
  return {
    id: row.id,
    title: row.title,
    origin: row.origin,
    kind: isAutomaticTaskKind(row.kind) ? row.kind : null,
    due_date: row.due_date,
    stage,
    assignee_ids: row.assignees.map((a) => a.user_id),
  };
}

const CLAIM_COLUMNS =
  "id, title, origin, kind, due_date, assignees:task_assignees(user_id)";

export const tasksDaily = inngest.createFunction(
  {
    id: "tasks-daily",
    name: "Tareas — recurrentes, automáticas y avisos",
    retries: 2,
    // 06:17 Argentina: before the day starts, off the hour.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 17 6 * * *" }],
  },
  async ({ step }) => {
    const supabase = getServiceClient();
    const today = await step.run("today", () => todayInAR());

    const materialized = await step.run("materialize-recurring", async () => {
      const { data, error } = await supabase.rpc(
        "materialize_recurring_tasks",
        { p_today: today },
      );
      if (error) throw new Error(`materialize-recurring: ${error.message}`);
      return data;
    });

    const changes = await step.run("sync-automatic", async () => {
      const { data, error } = await supabase.rpc("sync_automatic_tasks", {
        p_today: today,
      });
      if (error) throw new Error(`sync-automatic: ${error.message}`);
      return data ?? [];
    });
    const created = changes.filter((c) => c.change === "created");

    // Every open automatic task with no assignee, not only this run's
    // `created`: a task whose assign step failed on an earlier day shows up
    // there as `updated` and would stay unassigned (and unannounced).
    const assigned = await step.run("assign-new", async () => {
      const unassigned = await paginateRange((from, to) =>
        supabase
          .from("tasks")
          .select("id, kind, task_assignees(task_id)")
          .eq("origin", "automatic")
          .eq("status", "open")
          .is("task_assignees", null)
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (unassigned.error) {
        throw new Error(`assign-new: ${unassigned.error.message}`);
      }
      let rows = 0;
      for (const kind of AUTOMATIC_TASK_KINDS) {
        const taskIds = unassigned.data
          .filter((t) => t.kind === kind)
          .map((t) => t.id);
        if (taskIds.length === 0) continue;
        const users = await usersWithAll([
          "tasks:read",
          ...TASK_SOURCES[kind].assign,
        ]);
        const inserts = taskIds.flatMap((task_id) =>
          [...users].map((user_id) => ({ task_id, user_id })),
        );
        if (inserts.length === 0) continue;
        const { error } = await supabase
          .from("task_assignees")
          .upsert(inserts, {
            onConflict: "task_id,user_id",
            ignoreDuplicates: true,
          });
        if (error) throw new Error(`assign-new: ${error.message}`);
        rows += inserts.length;
      }
      return rows;
    });

    // Claimed first so a retry of the insert never sends twice. One claim
    // per step: a retry re-runs only the claim that failed, so the rows the
    // other one already stamped keep their memoized notices.
    const claimedDue = await step.run("claim-due", async () => {
      const due = await supabase
        .from("tasks")
        .update({ notified_stage: "due" })
        .eq("status", "open")
        .eq("due_date", today)
        .is("notified_stage", null)
        .select(CLAIM_COLUMNS);
      if (due.error) throw new Error(`claim-due: ${due.error.message}`);
      return (due.data ?? [])
        .map((r) => toDueTask(r, "due"))
        .filter((t): t is DueTask => t !== null);
    });
    const claimedOverdue = await step.run("claim-overdue", async () => {
      const overdue = await supabase
        .from("tasks")
        .update({ notified_stage: "overdue" })
        .eq("status", "open")
        .lt("due_date", today)
        .gte("due_date", shiftIsoDate(today, -OVERDUE_NOTICE_DAYS))
        .or("notified_stage.is.null,notified_stage.eq.due")
        .select(CLAIM_COLUMNS);
      if (overdue.error) {
        throw new Error(`claim-overdue: ${overdue.error.message}`);
      }
      return (overdue.data ?? [])
        .map((r) => toDueTask(r, "overdue"))
        .filter((t): t is DueTask => t !== null);
    });
    const claimed = [...claimedDue, ...claimedOverdue];

    const notified = await step.run("notify-due", async () => {
      if (claimed.length === 0) return 0;
      const kinds = new Set(claimed.flatMap((t) => (t.kind ? [t.kind] : [])));
      const readers = new Map<AutomaticTaskKind, Set<string>>();
      for (const kind of kinds) {
        readers.set(kind, await usersWithAll(TASK_SOURCES[kind].read));
      }
      const rows = buildDueNotifications(
        claimed,
        (userId, kind) => readers.get(kind)?.has(userId) ?? false,
      );
      if (rows.length === 0) return 0;
      const { error } = await supabase.from("notifications").insert(rows);
      if (error) throw new Error(`notify-due: ${error.message}`);
      return rows.length;
    });

    const summary = {
      materialized,
      created: created.length,
      updated: changes.filter((c) => c.change === "updated").length,
      closed: changes.filter((c) => c.change === "closed").length,
      // Not "assigned": the logger redacts keys containing "sign".
      delegated: assigned,
      notified,
    };
    logger.info("tasks.daily.done", summary);
    return summary;
  },
);
