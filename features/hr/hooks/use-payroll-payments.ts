"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  bulkCreatePayrollPaymentsAction,
  createPayrollPaymentAction,
  deletePayrollPaymentAction,
  listPayrollPaymentsAction,
} from "../actions/payroll-payments-actions";
import { payrollKeys } from "../lib/payroll-keys";

const paymentKeys = {
  byEntry: (entryId: string) =>
    [...payrollKeys.all, "payments", "byEntry", entryId] as const,
};

/** A payroll payment is a cash movement with its own fiscal entry. */
const PAYMENT_EFFECT_KEYS = [...CASH_KEYS, ...LEDGER_KEYS] as const;

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
      invalidateKeys(qc, PAYMENT_EFFECT_KEYS);
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

type BulkVars = {
  entry_ids: string[];
  account_id: string;
  channel_id: string;
  amount_each: number;
  method: "transferencia" | "efectivo";
  paid_at: string;
  notes?: string | null;
  period_year: number;
  period_month: number;
};

export function useBulkCreatePayrollPayments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period_year: _y, period_month: _m, ...rest }: BulkVars) =>
      runAction(() => bulkCreatePayrollPaymentsAction(rest)),
    onSuccess: (_data, vars) => {
      invalidateKeys(qc, PAYMENT_EFFECT_KEYS);
      // Invalidate all the period's entries: the grid recomputes
      // balances for each one.
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
      for (const id of vars.entry_ids) {
        qc.invalidateQueries({ queryKey: paymentKeys.byEntry(id) });
      }
    },
  });
}

export function useDeletePayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteVars) =>
      runAction(() => deletePayrollPaymentAction({ id })),
    onSuccess: (_data, vars) => {
      invalidateKeys(qc, PAYMENT_EFFECT_KEYS);
      qc.invalidateQueries({ queryKey: paymentKeys.byEntry(vars.entry_id) });
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}
