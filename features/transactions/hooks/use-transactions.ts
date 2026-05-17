"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { getMutationId } from "@/lib/query/get-mutation-id";
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

export const TRANSACTIONS_PAGE_SIZE = 50;

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

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createTransactionAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
    },
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createTransferAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateTransactionAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
      const id = getMutationId(variables);
      if (id) qc.invalidateQueries({ queryKey: transactionsKeys.byId(id) });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteTransactionAction(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
    },
  });
}
