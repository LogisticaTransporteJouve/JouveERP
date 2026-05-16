"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  addPayrollEntryExtraAction,
  closePayrollPeriodAction,
  getPayrollPeriodAction,
  listPayrollEntryExtrasAction,
  listPayrollPeriodsAction,
  removePayrollEntryExtraAction,
  reopenPayrollPeriodAction,
  seedPayrollPeriodAction,
  updatePayrollEntryAction,
  updatePayrollEntryExtraAction,
} from "../actions/payroll-actions";
import { payrollKeys } from "../lib/payroll-keys";

export function usePayrollPeriods() {
  return useSuspenseQuery({
    queryKey: payrollKeys.periods(),
    queryFn: () => runAction(() => listPayrollPeriodsAction()),
  });
}

export function usePayrollPeriod(year: number, month: number) {
  return useSuspenseQuery({
    queryKey: payrollKeys.period(year, month),
    queryFn: () => runAction(() => getPayrollPeriodAction(year, month)),
  });
}

export function useSeedPayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { year: number; month: number }) =>
      runAction(() => seedPayrollPeriodAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.all });
    },
  });
}

export function useClosePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => closePayrollPeriodAction({ id })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.all });
    },
  });
}

export function useReopenPayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => reopenPayrollPeriodAction({ id })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.all });
    },
  });
}

type UpdateEntryVars = {
  id: string;
  period_year: number;
  period_month: number;
  sueldo_neto?: number;
  vacaciones_monto?: number;
  viaticos?: number;
  deudas?: number;
  telefono?: number;
  notes?: string | null;
};

export function useUpdatePayrollEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period_year: _y, period_month: _m, ...rest }: UpdateEntryVars) =>
      runAction(() => updatePayrollEntryAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}

// ─── Extras ──────────────────────────────────────────────────────────────────

export function usePayrollEntryExtras(entryId: string) {
  return useQuery({
    queryKey: payrollKeys.extras(entryId),
    queryFn: () => runAction(() => listPayrollEntryExtrasAction(entryId)),
  });
}

type AddExtraVars = {
  entry_id: string;
  amount: number;
  description: string;
  period_year: number;
  period_month: number;
};

export function useAddPayrollEntryExtra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period_year: _y, period_month: _m, ...rest }: AddExtraVars) =>
      runAction(() => addPayrollEntryExtraAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: payrollKeys.extras(vars.entry_id) });
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}

type UpdateExtraVars = {
  id: string;
  entry_id: string;
  amount?: number;
  description?: string;
  period_year: number;
  period_month: number;
};

export function useUpdatePayrollEntryExtra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entry_id: _e,
      period_year: _y,
      period_month: _m,
      ...rest
    }: UpdateExtraVars) =>
      runAction(() => updatePayrollEntryExtraAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: payrollKeys.extras(vars.entry_id) });
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}

type RemoveExtraVars = {
  id: string;
  entry_id: string;
  period_year: number;
  period_month: number;
};

export function useRemovePayrollEntryExtra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: RemoveExtraVars) =>
      runAction(() => removePayrollEntryExtraAction({ id })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: payrollKeys.extras(vars.entry_id) });
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}
