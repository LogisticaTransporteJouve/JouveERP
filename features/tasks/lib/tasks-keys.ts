import type { TaskScope, TaskStatusFilter } from "../schema";

/** Query keys for the tasks feature. */
export const tasksKeys = {
  all: ["tasks"] as const,
  list: (scope: TaskScope, status: TaskStatusFilter) =>
    [...tasksKeys.all, "list", scope, status] as const,
  detail: (id: string) => [...tasksKeys.all, "detail", id] as const,
  users: () => [...tasksKeys.all, "users"] as const,
  recurring: () => [...tasksKeys.all, "recurring"] as const,
};
