"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";
import { runAction } from "@/lib/query/run-action";

import {
  getLateInterestGeneralRateAction,
  issueLateInterestNdAction,
  issueLateInterestNdsBulkAction,
  listLateInterestCandidatesAction,
  setClientLateInterestRateAction,
  setLateInterestGeneralRateAction,
} from "../actions/late-interest-actions";
import { lateInterestKeys } from "../lib/late-interest-keys";
import type {
  ClientRateInput,
  GeneralRateInput,
  IssueLateInterestBulkInput,
  IssueLateInterestInput,
} from "../schema";

export function useLateInterestCandidates(
  asOf: string,
  isFiscal: boolean | null,
) {
  return useSuspenseQuery({
    queryKey: lateInterestKeys.candidates(asOf, isFiscal),
    queryFn: () =>
      runAction(() =>
        listLateInterestCandidatesAction({ as_of: asOf, isFiscal }),
      ),
  });
}

export function useLateInterestGeneralRate() {
  return useSuspenseQuery({
    queryKey: lateInterestKeys.settings(),
    queryFn: () => runAction(() => getLateInterestGeneralRateAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: lateInterestKeys.all });
}

/** An ND adds a comprobante (and a debt to the aging). Refreshes on failure
 *  too: the ND can be issued and then fail to link to its comprobante. */
export function useIssueLateInterestNd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueLateInterestInput) =>
      runAction(() => issueLateInterestNdAction(input)),
    onSettled: () =>
      Promise.all([
        invalidate(qc),
        qc.invalidateQueries({ queryKey: invoicesKeys.all }),
        qc.invalidateQueries({ queryKey: agingKeys.all }),
      ]),
  });
}

/** Several NDs; refreshes even when some failed (others were issued). */
export function useIssueLateInterestNdsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueLateInterestBulkInput) =>
      runAction(() => issueLateInterestNdsBulkAction(input)),
    onSettled: () =>
      Promise.all([
        invalidate(qc),
        qc.invalidateQueries({ queryKey: invoicesKeys.all }),
        qc.invalidateQueries({ queryKey: agingKeys.all }),
      ]),
  });
}

export function useSetLateInterestGeneralRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GeneralRateInput) =>
      runAction(() => setLateInterestGeneralRateAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetClientLateInterestRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientRateInput) =>
      runAction(() => setClientLateInterestRateAction(input)),
    onSuccess: () => invalidate(qc),
  });
}
