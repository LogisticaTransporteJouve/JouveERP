"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

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
  return useSuspenseQuery({
    queryKey: loansKeys.list(),
    queryFn: () => runAction(() => listLoansAction()),
  });
}

export function useLoan(id: string) {
  return useSuspenseQuery({
    queryKey: loansKeys.detail(id),
    queryFn: () => runAction(() => getLoanAction(id)),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: loansKeys.all });
  // Payments touch cash + the cash-flow projection.
  qc.invalidateQueries({ queryKey: ["treasury"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
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
    mutationFn: (input: unknown) => runAction(() => payInstallmentAction(input)),
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
