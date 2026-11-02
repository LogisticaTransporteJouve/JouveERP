import type { AutomaticTaskKind, TaskOrigin } from "../schema";

import { RESTRICTED_TASK_TITLE } from "./sources";

export type DueStage = "due" | "overdue";

/** An open task whose due notification the cron claimed. */
export type DueTask = {
  id: string;
  title: string;
  origin: TaskOrigin;
  kind: AutomaticTaskKind | null;
  due_date: string;
  stage: DueStage;
  assignee_ids: readonly string[];
};

export type TaskDueNotification = {
  recipient_id: string;
  sender_id: null;
  type: "task_due";
  metadata: {
    task_id: string;
    due_date: string;
    stage: DueStage;
    preview: string;
  };
};

/** One notification per assignee of each task. The preview is the title, or
 *  the neutral one for an assignee who cannot read the task's source module
 *  (`canSeeSource`). */
export function buildDueNotifications(
  tasks: readonly DueTask[],
  canSeeSource: (userId: string, kind: AutomaticTaskKind) => boolean,
): TaskDueNotification[] {
  return tasks.flatMap((task) =>
    task.assignee_ids.map((recipient_id) => {
      const visible =
        task.origin !== "automatic" ||
        (task.kind !== null && canSeeSource(recipient_id, task.kind));
      return {
        recipient_id,
        sender_id: null,
        type: "task_due" as const,
        metadata: {
          task_id: task.id,
          due_date: task.due_date,
          stage: task.stage,
          preview: visible ? task.title : RESTRICTED_TASK_TITLE,
        },
      };
    }),
  );
}
