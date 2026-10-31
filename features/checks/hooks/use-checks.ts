"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { runAction } from "@/lib/query/run-action";

import {
  createCheckAction,
  creditCheckAction,
  depositCheckAction,
  getChequeByIdAction,
  listChecksAction,
  rejectCheckAction,
} from "../actions/checks-actions";
import { checksKeys } from "../lib/checks-keys";

export function useChecksList() {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: checksKeys.list(isFiscal),
    queryFn: () => runAction(() => listChecksAction({ isFiscal })),
  });
}

export function useCheckDetail(id: string) {
  return useSuspenseQuery({
    queryKey: checksKeys.detail(id),
    queryFn: () => runAction(() => getChequeByIdAction(id)),
  });
}

// Mutations -----------------------------------------------------------------

function makeChequeMutation<TInput, TData>(
  fn: (
    input: TInput,
  ) => Promise<{ ok: true; data: TData } | { ok: false; error: string }>,
) {
  return function useChequeMutation() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: TInput) => runAction(() => fn(input)),
      // All check mutations may have generated transactions, so we
      // invalidate both feature caches.
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: checksKeys.all });
        qc.invalidateQueries({ queryKey: transactionsKeys.all });
      },
    });
  };
}

export const useCreateCheque = makeChequeMutation(createCheckAction);
export const useDepositCheque = makeChequeMutation(depositCheckAction);
export const useCreditCheque = makeChequeMutation(creditCheckAction);
export const useRejectCheque = makeChequeMutation(rejectCheckAction);
