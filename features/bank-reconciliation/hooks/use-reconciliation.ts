"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { tasksKeys } from "@/features/tasks/lib/tasks-keys";
import { listPayableTaxDocumentsAction } from "@/features/taxes/actions/tax-payment-link-actions";
import { taxesKeys } from "@/features/taxes/lib/taxes-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { loansKeys } from "@/features/loans/lib/loans-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  acceptSuggestionsAction,
  createLineTaxPaymentAction,
  createLineTransactionAction,
  getReconciliationAction,
  ignoreLineAction,
  listReconciliationAccountsAction,
  matchLineAction,
  matchLineToReceiptAction,
  payLoanInstallmentFromLineAction,
  matchLinesToMovementAction,
  restoreLineAction,
  unmatchLineAction,
} from "../actions/reconciliation-actions";
import { reconciliationKeys } from "../lib/reconciliation-keys";
import type {
  CreateLineTaxPaymentInput,
  CreateLineTransactionInput,
  IgnoreLineInput,
  MatchLineInput,
  MatchLineToReceiptInput,
  PayLoanFromLineInput,
  MatchLinesToMovementInput,
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

/** A match changes the page and locks or frees movements of Caja (whose
 *  list marks the reconciled ones). */
function useReconciliationMutation<I, O>(
  fn: (input: I) => Promise<O>,
  alsoKeys: readonly (readonly unknown[])[] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidateKeys(qc, [
        reconciliationKeys.all,
        transactionsKeys.all,
        ...alsoKeys,
      ]);
    },
  });
}

export function useMatchLine() {
  return useReconciliationMutation((input: MatchLineInput) =>
    runAction(() => matchLineAction(input)),
  );
}

export function useMatchLineToReceipt() {
  return useReconciliationMutation((input: MatchLineToReceiptInput) =>
    runAction(() => matchLineToReceiptAction(input)),
  );
}

export function usePayLoanFromLine() {
  return useReconciliationMutation(
    (input: PayLoanFromLineInput) =>
      runAction(() => payLoanInstallmentFromLineAction(input)),
    [loansKeys.all, ...CASH_KEYS],
  );
}

export function useMatchLinesToMovement() {
  return useReconciliationMutation((input: MatchLinesToMovementInput) =>
    runAction(() => matchLinesToMovementAction(input)),
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

/** The open tax documents a debit line can pay; only fetched while the
 *  create dialog offers "Pago de impuesto". */
export function usePayableTaxDocuments(enabled: boolean) {
  return useQuery({
    queryKey: taxesKeys.payable(),
    queryFn: () => runAction(() => listPayableTaxDocumentsAction()),
    enabled,
  });
}

/** A tax payment also changes the tax documents and their due-date tasks. */
export function useCreateLineTaxPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLineTaxPaymentInput) =>
      runAction(() => createLineTaxPaymentAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, [
        reconciliationKeys.all,
        taxesKeys.all,
        tasksKeys.all,
        ...CASH_KEYS,
        ...LEDGER_KEYS,
      ]);
    },
  });
}
