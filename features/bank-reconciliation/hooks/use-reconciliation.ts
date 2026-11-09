"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import { checksKeys } from "@/features/checks/lib/checks-keys";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { accountKeys } from "@/features/hr/lib/account-keys";
import { employeesKeys } from "@/features/hr/lib/employees-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { receiptsKeys } from "@/features/receipts/lib/receipts-keys";
import { tasksKeys } from "@/features/tasks/lib/tasks-keys";
import { listPayableTaxDocumentsAction } from "@/features/taxes/actions/tax-payment-link-actions";
import { taxesKeys } from "@/features/taxes/lib/taxes-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { loansKeys } from "@/features/loans/lib/loans-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { cardStatementsKeys } from "@/features/card-statements/lib/card-statements-keys";
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
  payCardStatementFromLineAction,
  transferFromLineAction,
  depositCheckFromLineAction,
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
  PayCardFromLineInput,
  TransferFromLineInput,
  DepositCheckFromLineInput,
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
  // On settled, not on success: an action may write and then report a
  // later step failed (a transfer booked whose line did not match), and the
  // page has to show what was written.
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
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

export function useDepositCheckFromLine() {
  return useReconciliationMutation(
    (input: DepositCheckFromLineInput) =>
      runAction(() => depositCheckFromLineAction(input)),
    [
      checksKeys.all,
      ...CASH_KEYS,
      ...LEDGER_KEYS,
      clientsKeys.all,
      agingKeys.all,
      receiptsKeys.all,
    ],
  );
}

export function useTransferFromLine() {
  return useReconciliationMutation(
    (input: TransferFromLineInput) =>
      runAction(() => transferFromLineAction(input)),
    [...CASH_KEYS, ...LEDGER_KEYS],
  );
}

export function usePayCardFromLine() {
  return useReconciliationMutation(
    (input: PayCardFromLineInput) =>
      runAction(() => payCardStatementFromLineAction(input)),
    [
      cardStatementsKeys.all,
      ...CASH_KEYS,
      ...LEDGER_KEYS,
      employeesKeys.all,
      accountKeys.all,
    ],
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

/** Many lines at once ("Aceptar impuestos y gastos"): one after the other,
 *  refreshing the statement, Caja and the books once at the end. Refreshing
 *  after each line made every next line wait for the whole statement. */
export function useCreateLineTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inputs: readonly CreateLineTransactionInput[]) => {
      let done = 0;
      const failed: string[] = [];
      for (const input of inputs) {
        try {
          await runAction(() => createLineTransactionAction(input));
          done += 1;
        } catch (err) {
          failed.push(err instanceof Error ? err.message : String(err));
        }
      }
      return { done, failed };
    },
    onSettled: () => {
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
