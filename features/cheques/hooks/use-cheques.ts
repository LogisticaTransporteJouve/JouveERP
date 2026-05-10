"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { runAction } from "@/lib/query/run-action";

import {
  createChequeAction,
  creditChequeAction,
  depositChequeAction,
  endorseChequeAction,
  getChequeByIdAction,
  listChequesAction,
  rejectChequeAction,
} from "../actions/cheques-actions";
import { chequesKeys } from "../lib/cheques-keys";

export function useChequesList() {
  return useSuspenseQuery({
    queryKey: chequesKeys.list(),
    queryFn: () => runAction(() => listChequesAction()),
  });
}

export function useChequeDetail(id: string) {
  return useSuspenseQuery({
    queryKey: chequesKeys.detail(id),
    queryFn: () => runAction(() => getChequeByIdAction(id)),
  });
}

// Mutations -----------------------------------------------------------------

function makeChequeMutation<TInput, TData>(
  fn: (input: TInput) => Promise<{ ok: true; data: TData } | { ok: false; error: string }>,
) {
  return function useChequeMutation() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: TInput) => runAction(() => fn(input)),
      // All cheque mutations may have generated transactions, so we
      // invalidate both feature caches.
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: chequesKeys.all });
        qc.invalidateQueries({ queryKey: transactionsKeys.all });
      },
    });
  };
}

export const useCreateCheque = makeChequeMutation(createChequeAction);
export const useDepositCheque = makeChequeMutation(depositChequeAction);
export const useCreditCheque = makeChequeMutation(creditChequeAction);
export const useEndorseCheque = makeChequeMutation(endorseChequeAction);
export const useRejectCheque = makeChequeMutation(rejectChequeAction);
