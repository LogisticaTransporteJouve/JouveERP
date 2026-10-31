"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { getMutationId } from "@/lib/query/get-mutation-id";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  createTransactionAction,
  createTransferAction,
  deleteTransactionAction,
  listTransactionsAction,
  updateTransactionAction,
  type TransactionListItem,
  type TransactionListPage,
} from "../actions/transactions-actions";
import { transactionsKeys } from "../lib/transactions-keys";
import type { TransactionFilters } from "../schema";
import { TRANSACTIONS_PAGE_SIZE } from "../lib/pagination";

export function useTransactionsList(filters: TransactionFilters) {
  const query = useSuspenseInfiniteQuery({
    queryKey: transactionsKeys.list(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listTransactionsAction({
          ...filters,
          offset: pageParam,
          limit: TRANSACTIONS_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: TransactionListPage) =>
      lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<TransactionListItem[]>(
    () => query.data.pages.flatMap((page) => page.items),
    [query.data],
  );

  return { ...query, items };
}

// Mutations -----------------------------------------------------------------

/** A movement changes caja, balances, treasury and its fiscal entry. */
const TRANSACTION_EFFECT_KEYS = [...CASH_KEYS, ...LEDGER_KEYS] as const;

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createTransactionAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, TRANSACTION_EFFECT_KEYS);
    },
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createTransferAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, TRANSACTION_EFFECT_KEYS);
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateTransactionAction(input)),
    onSuccess: (_data, variables) => {
      invalidateKeys(qc, TRANSACTION_EFFECT_KEYS);
      const id = getMutationId(variables);
      if (id) qc.invalidateQueries({ queryKey: transactionsKeys.byId(id) });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteTransactionAction(id)),
    onSuccess: () => {
      invalidateKeys(qc, TRANSACTION_EFFECT_KEYS);
    },
  });
}
