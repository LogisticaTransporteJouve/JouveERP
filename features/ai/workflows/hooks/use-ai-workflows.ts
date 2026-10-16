"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createAiWorkflowAction,
  deleteAiWorkflowAction,
  listAiWorkflowRunsAction,
  listAiWorkflowsAction,
  setAiWorkflowActiveAction,
} from "../actions";
import { workflowsKeys } from "../lib/workflows-keys";
import type { AiWorkflowDraft } from "../schema";

export function useAiWorkflows() {
  return useQuery({
    queryKey: workflowsKeys.list(),
    queryFn: () => runAction(() => listAiWorkflowsAction()),
  });
}

export function useAiWorkflowRuns(workflowId: string | null) {
  return useQuery({
    queryKey: workflowsKeys.runs(workflowId ?? ""),
    queryFn: () =>
      runAction(() => listAiWorkflowRunsAction({ id: workflowId })),
    enabled: workflowId !== null,
  });
}

function useInvalidateWorkflows() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: workflowsKeys.all });
}

export function useCreateAiWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useMutation({
    mutationFn: (draft: AiWorkflowDraft) =>
      runAction(() => createAiWorkflowAction(draft)),
    onSuccess: invalidate,
  });
}

export function useSetAiWorkflowActive() {
  const invalidate = useInvalidateWorkflows();
  return useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      runAction(() => setAiWorkflowActiveAction(input)),
    onSuccess: invalidate,
  });
}

export function useDeleteAiWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteAiWorkflowAction({ id })),
    onSuccess: invalidate,
  });
}
