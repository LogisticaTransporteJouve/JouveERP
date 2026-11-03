"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { managementKeys } from "@/features/management/lib/management-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import { purchaseInvoicesKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";

import { recategorizeExpenseAction } from "../actions/recategorize-actions";
import type { RecategorizeExpenseInput } from "../schema";

/** Recategorizes an expense: it re-posts the entry, so besides the list it
 *  came from, the books and Gestión refresh. */
export function useRecategorizeExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecategorizeExpenseInput) =>
      runAction(() => recategorizeExpenseAction(input)),
    onSuccess: (_data, input) =>
      invalidateKeys(qc, [
        input.source === "transactions"
          ? transactionsKeys.all
          : purchaseInvoicesKeys.all,
        managementKeys.all,
        ...LEDGER_KEYS,
      ]),
  });
}
