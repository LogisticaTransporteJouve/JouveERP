"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createAccountAction,
  listAccountsAction,
  setAccountActiveAction,
  updateAccountAction,
} from "../actions/accounts-actions";
import { accountsKeys } from "../lib/accounts-keys";

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
    mutationFn: (input: unknown) =>
      runAction(() => createAccountAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKeys.all });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateAccountAction(input)),
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
