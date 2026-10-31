"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { runAction } from "@/lib/query/run-action";

import {
  clearAccountOpeningBalanceAction,
  createAccountAction,
  getAccountOpeningBalanceAction,
  listAccountsAction,
  setAccountActiveAction,
  setAccountOpeningBalanceAction,
  updateAccountAction,
} from "../actions/accounts-actions";
import { accountsKeys } from "../lib/accounts-keys";
import type { AccountOpeningBalanceInput } from "../schema";

const ONE_MINUTE = 60_000;

export function useAccountsList() {
  return useSuspenseQuery({
    queryKey: accountsKeys.list(),
    queryFn: () => runAction(() => listAccountsAction()),
    staleTime: ONE_MINUTE,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createAccountAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKeys.all });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateAccountAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKeys.all });
    },
  });
}

export function useSetAccountActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setAccountActiveAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKeys.all });
    },
  });
}

export function useAccountOpeningBalance(id: string, enabled = true) {
  return useQuery({
    queryKey: accountsKeys.openingBalance(id),
    queryFn: () => runAction(() => getAccountOpeningBalanceAction(id)),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useSetAccountOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountOpeningBalanceInput) =>
      runAction(() => setAccountOpeningBalanceAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: accountsKeys.openingBalance(variables.account_id),
      });
      qc.invalidateQueries({ queryKey: accountsKeys.all });
      // The transactions list also changes (the adjustment row is added).
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
    },
  });
}

export function useClearAccountOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      runAction(() => clearAccountOpeningBalanceAction(accountId)),
    onSuccess: (_data, accountId) => {
      qc.invalidateQueries({
        queryKey: accountsKeys.openingBalance(accountId),
      });
      qc.invalidateQueries({ queryKey: accountsKeys.all });
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
    },
  });
}
