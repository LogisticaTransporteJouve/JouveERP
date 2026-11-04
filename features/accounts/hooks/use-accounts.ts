"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  clearAccountOpeningBalanceAction,
  createAccountAction,
  getAccountHasMovementsAction,
  getAccountOpeningBalanceAction,
  listAccountsAction,
  setAccountActiveAction,
  setAccountOpeningBalanceAction,
  updateAccountAction,
} from "../actions/accounts-actions";
import { accountsKeys } from "../lib/accounts-keys";
import type { Account, AccountOpeningBalanceInput } from "../schema";

const ONE_MINUTE = 60_000;

export function useAccountsList() {
  return useSuspenseQuery({
    queryKey: accountsKeys.list(),
    queryFn: () => runAction(() => listAccountsAction()),
    staleTime: ONE_MINUTE,
  });
}

const NO_ACCOUNTS: Account[] = [];

/** Shown where an account would be picked when the user cannot read them. */
export const ACCOUNTS_UNAVAILABLE_MESSAGE =
  "No tenés permiso para ver cuentas, así que no podés elegir una.";

/** The accounts list for a page or dialog outside Cuentas (Recibos, OP,
 *  Movimientos, Cheques, Sueldos). It never suspends or throws: a per-user
 *  deny of accounts:read (`canRead` false, or the read refused) or a failed
 *  read gives no accounts and a message instead of taking the page down;
 *  `retry` reads again (null when there is nothing to retry). A failed
 *  background refetch keeps the accounts already read, so a filled form is
 *  not replaced by the error. Same cache as `useAccountsList`. */
export function useAccountOptions(canRead = true): {
  accounts: Account[];
  error: string | null;
  pending: boolean;
  retry: (() => void) | null;
} {
  const query = useQuery({
    queryKey: accountsKeys.list(),
    queryFn: () => runAction(() => listAccountsAction()),
    staleTime: ONE_MINUTE,
    enabled: canRead,
  });
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  if (!canRead) {
    return {
      accounts: NO_ACCOUNTS,
      error: ACCOUNTS_UNAVAILABLE_MESSAGE,
      pending: false,
      retry: null,
    };
  }
  // The refused read says why ("No tenés permiso para ver cuentas.").
  if (query.isError && query.data === undefined) {
    return {
      accounts: NO_ACCOUNTS,
      error: query.error.message,
      pending: query.isFetching,
      retry,
    };
  }
  return {
    accounts: query.data ?? NO_ACCOUNTS,
    error: null,
    pending: query.isPending,
    retry,
  };
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

/** Read fresh each time the edit form opens: a movement booked elsewhere
 *  freezes the account's currency, type and opening balance. */
export function useAccountHasMovements(id: string, enabled: boolean) {
  return useQuery({
    queryKey: accountsKeys.hasMovements(id),
    queryFn: () => runAction(() => getAccountHasMovementsAction(id)),
    staleTime: 0,
    enabled,
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
      // The adjustment row is a cash movement with a fiscal entry.
      invalidateKeys(qc, [...CASH_KEYS, ...LEDGER_KEYS]);
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
      invalidateKeys(qc, [...CASH_KEYS, ...LEDGER_KEYS]);
    },
  });
}
