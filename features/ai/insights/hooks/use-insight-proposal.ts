"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { runAction } from "@/lib/query/run-action";

import {
  acceptAiProposalAction,
  dismissAiProposalAction,
  prepareInsightProposalAction,
} from "../../actions/proposal-actions";

/** Prepares (or reopens) the proposal an insight offers. */
export function usePrepareInsightProposal() {
  return useMutation({
    mutationFn: (insightId: string) =>
      runAction(() => prepareInsightProposalAction(insightId)),
  });
}

/** The write lands in another feature (a task, an ND, a bank match), so
 *  every cached query is invalidated, as when a chat proposal is confirmed,
 *  and the server-rendered dashboard widgets are refreshed. */
export function useAcceptAiProposal() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (id: string) => runAction(() => acceptAiProposalAction(id)),
    // Not awaited: the toast should not wait for every refetch.
    onSettled: () => {
      void qc.invalidateQueries();
      router.refresh();
    },
  });
}

export function useDismissAiProposal() {
  return useMutation({
    mutationFn: (id: string) => runAction(() => dismissAiProposalAction(id)),
  });
}
