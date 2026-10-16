"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  confirmAiProposalAction,
  declineAiProposalAction,
  listAiConfirmationsAction,
  reviseAiProposalAction,
} from "../actions/confirmation-actions";
import { aiKeys } from "../lib/ai-keys";

/** The session's proposal revisions; the cards and the composer read their
 *  state from here (the transcript's tool results never change). */
export function useAiConfirmations(sessionId: string) {
  return useQuery({
    queryKey: aiKeys.confirmations(sessionId),
    queryFn: () => runAction(() => listAiConfirmationsAction(sessionId)),
  });
}

function useInvalidateConfirmations(sessionId: string) {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: aiKeys.confirmations(sessionId) });
}

/** A confirmed proposal writes into another feature (leaves, journal,
 *  rates): every cached query is invalidated, not only the cards'. */
export function useConfirmAiProposal(sessionId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateConfirmations(sessionId);
  return useMutation({
    mutationFn: (id: string) => runAction(() => confirmAiProposalAction(id)),
    onSuccess: () => qc.invalidateQueries(),
    onError: invalidate,
  });
}

export function useDeclineAiProposal(sessionId: string) {
  const invalidate = useInvalidateConfirmations(sessionId);
  return useMutation({
    mutationFn: (id: string) => runAction(() => declineAiProposalAction(id)),
    onSettled: invalidate,
  });
}

export function useReviseAiProposal(sessionId: string) {
  const invalidate = useInvalidateConfirmations(sessionId);
  return useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: unknown }) =>
      runAction(() => reviseAiProposalAction(id, draft)),
    onSettled: invalidate,
  });
}
