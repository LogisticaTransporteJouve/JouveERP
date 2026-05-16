"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createPayrollPaymentAction,
  deletePayrollPaymentAction,
  listPayrollPaymentsAction,
  updatePayrollPaymentAction,
} from "../actions/payroll-payments-actions";
import { payrollKeys } from "../lib/payroll-keys";

const paymentKeys = {
  byEntry: (entryId: string) =>
    [...payrollKeys.all, "payments", "byEntry", entryId] as const,
};

export function usePayrollPayments(entryId: string) {
  return useQuery({
    queryKey: paymentKeys.byEntry(entryId),
    queryFn: () => runAction(() => listPayrollPaymentsAction(entryId)),
  });
}

type CreateVars = {
  entry_id: string;
  account_id: string;
  channel_id: string;
  amount: number;
  method: "transferencia" | "efectivo";
  paid_at: string;
  notes?: string | null;
  period_year: number;
  period_month: number;
};

export function useCreatePayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period_year: _y, period_month: _m, ...rest }: CreateVars) =>
      runAction(() => createPayrollPaymentAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: paymentKeys.byEntry(vars.entry_id) });
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}

type UpdateVars = {
  id: string;
  entry_id: string;
  account_id?: string;
  channel_id?: string;
  amount?: number;
  method?: "transferencia" | "efectivo";
  paid_at?: string;
  notes?: string | null;
  period_year: number;
  period_month: number;
};

export function useUpdatePayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entry_id: _e,
      period_year: _y,
      period_month: _m,
      ...rest
    }: UpdateVars) =>
      runAction(() => updatePayrollPaymentAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: paymentKeys.byEntry(vars.entry_id) });
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}

type DeleteVars = {
  id: string;
  entry_id: string;
  period_year: number;
  period_month: number;
};

export function useDeletePayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteVars) =>
      runAction(() => deletePayrollPaymentAction({ id })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: paymentKeys.byEntry(vars.entry_id) });
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}
