"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createRecurringTaskAction,
  listRecurringTasksAction,
  updateRecurringTaskAction,
} from "../actions/recurring-tasks-actions";
import {
  addTaskCommentAction,
  createTaskAction,
  getTaskDetailAction,
  listTasksAction,
  listTaskUserOptionsAction,
  setTaskAssigneesAction,
  setTaskDueDateAction,
  setTaskStatusAction,
} from "../actions/tasks-actions";
import { tasksKeys } from "../lib/tasks-keys";
import type { TaskScope, TaskStatusFilter } from "../schema";

export function useTasks(scope: TaskScope, status: TaskStatusFilter) {
  return useSuspenseQuery({
    queryKey: tasksKeys.list(scope, status),
    queryFn: () => runAction(() => listTasksAction({ scope, status })),
  });
}

export function useTaskDetail(id: string) {
  return useSuspenseQuery({
    queryKey: tasksKeys.detail(id),
    queryFn: () => runAction(() => getTaskDetailAction(id)),
  });
}

export function useTaskUsers() {
  return useSuspenseQuery({
    queryKey: tasksKeys.users(),
    queryFn: () => runAction(() => listTaskUserOptionsAction()),
    staleTime: 5 * 60_000,
  });
}

export function useRecurringTasks() {
  return useSuspenseQuery({
    queryKey: tasksKeys.recurring(),
    queryFn: () => runAction(() => listRecurringTasksAction()),
  });
}

/** Every task query: lists, details and recurrences change together. */
function useTaskMutation<I, O>(action: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKeys.all }),
  });
}

export function useCreateTask() {
  return useTaskMutation((input: unknown) =>
    runAction(() => createTaskAction(input)),
  );
}

export function useSetTaskStatus() {
  return useTaskMutation((input: { id: string; status: "open" | "done" }) =>
    runAction(() => setTaskStatusAction(input)),
  );
}

export function useSetTaskDueDate() {
  return useTaskMutation((input: { id: string; due_date: string | null }) =>
    runAction(() => setTaskDueDateAction(input)),
  );
}

export function useSetTaskAssignees() {
  return useTaskMutation((input: { id: string; assignee_ids: string[] }) =>
    runAction(() => setTaskAssigneesAction(input)),
  );
}

export function useAddTaskComment() {
  return useTaskMutation((input: { task_id: string; body: string }) =>
    runAction(() => addTaskCommentAction(input)),
  );
}

export function useCreateRecurringTask() {
  return useTaskMutation((input: unknown) =>
    runAction(() => createRecurringTaskAction(input)),
  );
}

export function useUpdateRecurringTask() {
  return useTaskMutation((input: unknown) =>
    runAction(() => updateRecurringTaskAction(input)),
  );
}
