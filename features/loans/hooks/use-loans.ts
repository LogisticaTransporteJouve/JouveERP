"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  cancelLoanAction,
  createLoanAction,
  getLoanAction,
  listLoansAction,
  payInstallmentAction,
  updateInstallmentAction,
} from "../actions/loans-actions";
import { loansKeys } from "../lib/loans-keys";

export function useLoans() {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: loansKeys.list(isFiscal),
    queryFn: () => runAction(() => listLoansAction({ isFiscal })),
  });
}

export function useLoan(id: string) {
  return useSuspenseQuery({
    queryKey: loansKeys.detail(id),
    queryFn: () => runAction(() => getLoanAction(id)),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  // Payments are cash movements with a fiscal entry.
  invalidateKeys(qc, [loansKeys.all, ...CASH_KEYS, ...LEDGER_KEYS]);
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createLoanAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateInstallmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function usePayInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => payInstallmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useCancelLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => cancelLoanAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
