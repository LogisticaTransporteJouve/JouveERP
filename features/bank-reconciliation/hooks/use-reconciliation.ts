"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  acceptSuggestionsAction,
  createLineTransactionAction,
  getReconciliationAction,
  ignoreLineAction,
  listReconciliationAccountsAction,
  matchLineAction,
  restoreLineAction,
  unmatchLineAction,
} from "../actions/reconciliation-actions";
import { reconciliationKeys } from "../lib/reconciliation-keys";
import type {
  CreateLineTransactionInput,
  IgnoreLineInput,
  MatchLineInput,
} from "../schema";

export function useReconciliationAccounts() {
  return useSuspenseQuery({
    queryKey: reconciliationKeys.accounts(),
    queryFn: () => runAction(() => listReconciliationAccountsAction()),
  });
}

export function useReconciliation(accountId: string, from: string, to: string) {
  return useSuspenseQuery({
    queryKey: reconciliationKeys.view(accountId, from, to),
    queryFn: () =>
      runAction(() =>
        getReconciliationAction({ account_id: accountId, from, to }),
      ),
  });
}

/** A match changes the page and locks or frees movements of Caja. */
function useReconciliationMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reconciliationKeys.all });
    },
  });
}

export function useMatchLine() {
  return useReconciliationMutation((input: MatchLineInput) =>
    runAction(() => matchLineAction(input)),
  );
}

export function useAcceptSuggestions() {
  return useReconciliationMutation((matches: MatchLineInput[]) =>
    runAction(() => acceptSuggestionsAction({ matches })),
  );
}

export function useUnmatchLine() {
  return useReconciliationMutation((lineId: string) =>
    runAction(() => unmatchLineAction({ line_id: lineId })),
  );
}

export function useIgnoreLine() {
  return useReconciliationMutation((input: IgnoreLineInput) =>
    runAction(() => ignoreLineAction(input)),
  );
}

export function useRestoreLine() {
  return useReconciliationMutation((lineId: string) =>
    runAction(() => restoreLineAction({ line_id: lineId })),
  );
}

/** A new movement also changes Caja, the balances and the books. */
export function useCreateLineTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLineTransactionInput) =>
      runAction(() => createLineTransactionAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, [
        reconciliationKeys.all,
        ...CASH_KEYS,
        ...LEDGER_KEYS,
      ]);
    },
  });
}
