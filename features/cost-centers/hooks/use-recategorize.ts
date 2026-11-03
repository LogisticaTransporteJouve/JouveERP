"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { purchaseInvoicesKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";

import { recategorizeExpenseAction } from "../actions/recategorize-actions";
import type { RecategorizeExpenseInput } from "../schema";

/** Recategorizes an expense and refreshes the list it came from. */
export function useRecategorizeExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecategorizeExpenseInput) =>
      runAction(() => recategorizeExpenseAction(input)),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({
        queryKey:
          input.source === "transactions"
            ? transactionsKeys.all
            : purchaseInvoicesKeys.all,
      });
    },
  });
}
