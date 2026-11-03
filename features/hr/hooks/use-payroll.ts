"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  addMissingPayrollEntriesAction,
  addPayrollEntryExtraAction,
  closePayrollPeriodAction,
  getPayrollPeriodAction,
  listPayrollEntryExtrasAction,
  listPayrollPeriodsAction,
  removePayrollEntryExtraAction,
  reopenPayrollPeriodAction,
  resetPayrollOverrideAction,
  seedPayrollPeriodAction,
  seedSacPeriodAction,
  updatePayrollEntryAction,
} from "../actions/payroll-actions";
import { payrollKeys } from "../lib/payroll-keys";
import type {
  PayrollOverrideField,
  PayrollPeriodKind,
  SacHalf,
} from "../payroll-schema";

export function usePayrollPeriods() {
  return useSuspenseQuery({
    queryKey: payrollKeys.periods(),
    queryFn: () => runAction(() => listPayrollPeriodsAction()),
  });
}

export function usePayrollPeriod(
  year: number,
  month: number,
  kind: PayrollPeriodKind = "monthly",
) {
  return useSuspenseQuery({
    queryKey: payrollKeys.periodOfKind(year, month, kind),
    queryFn: () => runAction(() => getPayrollPeriodAction(year, month, kind)),
    staleTime: 10 * 60_000,
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

export function useSeedSacPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { year: number; half: SacHalf }) =>
      runAction(() => seedSacPeriodAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.all });
    },
  });
}

/** Adds active employees missing from an open period (hired after it was generated). */
export function useAddMissingPayrollEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periodId: string) =>
      runAction(() => addMissingPayrollEntriesAction({ period_id: periodId })),
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
  embargo?: number;
  recibo_neto?: number | null;
  notes?: string | null;
};

export function useUpdatePayrollEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      period_year: _y,
      period_month: _m,
      ...rest
    }: UpdateEntryVars) => runAction(() => updatePayrollEntryAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: payrollKeys.period(vars.period_year, vars.period_month),
      });
    },
  });
}

/** Back to the computed Deudas or Embargo after it was typed by hand. */
export function useResetPayrollOverride(year: number, month: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; field: PayrollOverrideField }) =>
      runAction(() => resetPayrollOverrideAction(vars)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.period(year, month) });
    },
  });
}

// ─── Extras ──────────────────────────────────────────────────────────────────

export function usePayrollEntryExtras(entryId: string) {
  return useQuery({
    queryKey: payrollKeys.extras(entryId),
    queryFn: () => runAction(() => listPayrollEntryExtrasAction(entryId)),
    staleTime: 10 * 60_000,
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
    mutationFn: ({
      period_year: _y,
      period_month: _m,
      ...rest
    }: AddExtraVars) => runAction(() => addPayrollEntryExtraAction(rest)),
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
