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
  adoptInstallmentPaymentAction,
  applyInstallmentStatementAction,
  bookLoanOpeningAction,
  cancelLoanAction,
  createLoanAction,
  getLoanAction,
  listLoansAction,
  payInstallmentAction,
  recordBankPaymentsAction,
  recordLoanDisbursementAction,
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

/** A cuota set from the lender's statement: no Caja, no entry yet. */
export function useApplyInstallmentStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => applyInstallmentStatementAction(input)),
    onSuccess: () => invalidateKeys(qc, [loansKeys.all]),
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

export function useAdoptInstallmentPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => adoptInstallmentPaymentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useRecordLoanDisbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => recordLoanDisbursementAction(input)),
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

/** The bank's receipts and the opening debt post journal entries, not Caja. */
export function useRecordBankPayments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => recordBankPaymentsAction(input)),
    onSuccess: () => invalidateKeys(qc, [loansKeys.all, ...LEDGER_KEYS]),
  });
}

export function useBookLoanOpening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loanId: string) =>
      runAction(() => bookLoanOpeningAction({ loan_id: loanId })),
    onSuccess: () => invalidateKeys(qc, [loansKeys.all, ...LEDGER_KEYS]),
  });
}
