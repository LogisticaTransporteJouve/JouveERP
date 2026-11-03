"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  acceptAiProposalAction,
  dismissAiProposalAction,
  prepareInsightProposalAction,
} from "../../actions/proposal-actions";
import { insightsKeys } from "../lib/insights-keys";

/** Prepares (or reopens) the proposal an insight offers. */
export function usePrepareInsightProposal() {
  return useMutation({
    mutationFn: (insightId: string) =>
      runAction(() => prepareInsightProposalAction(insightId)),
  });
}

export function useAcceptAiProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => acceptAiProposalAction(id)),
    // The write may change what an indicator shows (a task, an ND).
    onSettled: () => qc.invalidateQueries({ queryKey: insightsKeys.list() }),
  });
}

export function useDismissAiProposal() {
  return useMutation({
    mutationFn: (id: string) => runAction(() => dismissAiProposalAction(id)),
  });
}
