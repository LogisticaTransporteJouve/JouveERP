import { z } from "zod";

import { listTasksAction } from "@/features/tasks/actions/tasks-actions";
import {
  TASK_SCOPES,
  TASK_STATUS_FILTERS,
  type TaskScope,
  type TaskStatusFilter,
} from "@/features/tasks/schema";
import { todayInAR } from "@/lib/format";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, okResult } from "../result";

// Read tool over /tasks: wraps listTasksAction, so it inherits its
// `tasks:read` gate and its neutral title for a task whose source module the
// user cannot read.

export async function runTasks(input: {
  scope?: TaskScope | null;
  status?: TaskStatusFilter | null;
}): Promise<AiRunResult> {
  const res = await listTasksAction({
    scope: input.scope ?? "all",
    status: input.status ?? "open",
  });
  if (!res.ok) return errResult(res.error);
  const { rows, truncated } = res.data;
  const today = todayInAR();
  const overdue = rows.filter(
    (t) => t.status === "open" && t.due_date !== null && t.due_date < today,
  ).length;
  return okResult(
    `${rows.length} tasks (${overdue} overdue)` +
      (truncated ? `; only the first ${rows.length} are listed.` : "."),
    { rows },
    { partial: truncated },
  );
}

export const getTasks = defineAiAction({
  name: "getTasks",
  domain: "general",
  permission: "tasks:read",
  sideEffect: "read",
  sources: ["tasks", "task_assignees"],
  description:
    "Team tasks (Tareas): title, due date, status, origin (manual, " +
    "recurring, automatic from a document to pay, collect or renew) and " +
    "assignee ids. For to-dos, pending items or what is overdue.",
  input: z.object({
    scope: z
      .enum(TASK_SCOPES)
      .nullish()
      .describe("'mine' (assigned to the user) or 'all' (default)."),
    status: z
      .enum(TASK_STATUS_FILTERS)
      .nullish()
      .describe("'open' (default), 'overdue' (open and past due) or 'done'."),
  }),
  run: (_ctx, input) => runTasks(input),
});
