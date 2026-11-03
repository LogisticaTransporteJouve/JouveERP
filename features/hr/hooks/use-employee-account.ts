"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  createDebtPlanAction,
  createManualMovementAction,
  deleteAccountMovementAction,
  deleteDebtPlanAction,
  getEmployeeAccountAction,
  recordEmployeeAccountCashAction,
  setDebtPlanStatusAction,
  updateAccountMovementAction,
  updateDebtPlanAction,
} from "../actions/employee-account-actions";
import {
  applySalaryRaiseAction,
  listSalaryChangesAction,
} from "../actions/salary-actions";
import {
  getPeriodTripExtrasAction,
  updateTripRatesAction,
} from "../actions/trip-extras-actions";
import { accountKeys } from "../lib/account-keys";
import { employeesKeys } from "../lib/employees-keys";
import { payrollKeys } from "../lib/payroll-keys";

export function useEmployeeAccount(employeeId: string) {
  return useQuery({
    queryKey: accountKeys.account(employeeId),
    queryFn: () => runAction(() => getEmployeeAccountAction(employeeId)),
  });
}

/** A plan or a plan credit changes the Deudas of draft planillas. */
function useAccountMutation<TInput, TOut>(
  employeeId: string,
  fn: (input: TInput) => Promise<TOut>,
  { cash = false }: { cash?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountKeys.account(employeeId) });
      qc.invalidateQueries({ queryKey: [...payrollKeys.all, "period"] });
      if (cash) invalidateKeys(qc, [...CASH_KEYS, ...LEDGER_KEYS]);
    },
  });
}

export function useCreateManualMovement(employeeId: string) {
  return useAccountMutation(employeeId, (input: unknown) =>
    runAction(() => createManualMovementAction(input)),
  );
}

/** An advance or a cash payment: also a treasury movement with its entry. */
export function useRecordAccountCash(employeeId: string) {
  return useAccountMutation(
    employeeId,
    (input: unknown) => runAction(() => recordEmployeeAccountCashAction(input)),
    { cash: true },
  );
}

export function useUpdateAccountMovement(employeeId: string) {
  return useAccountMutation(employeeId, (input: unknown) =>
    runAction(() => updateAccountMovementAction(input)),
  );
}

export function useDeleteAccountMovement(employeeId: string) {
  return useAccountMutation(
    employeeId,
    (id: string) => runAction(() => deleteAccountMovementAction({ id })),
    { cash: true },
  );
}

export function useCreateDebtPlan(employeeId: string) {
  return useAccountMutation(employeeId, (input: unknown) =>
    runAction(() => createDebtPlanAction(input)),
  );
}

export function useUpdateDebtPlan(employeeId: string) {
  return useAccountMutation(employeeId, (input: unknown) =>
    runAction(() => updateDebtPlanAction(input)),
  );
}

export function useSetDebtPlanStatus(employeeId: string) {
  return useAccountMutation(employeeId, (input: unknown) =>
    runAction(() => setDebtPlanStatusAction(input)),
  );
}

export function useDeleteDebtPlan(employeeId: string) {
  return useAccountMutation(employeeId, (id: string) =>
    runAction(() => deleteDebtPlanAction({ id })),
  );
}

// ─── Salary raises ───────────────────────────────────────────────────────────

export function useSalaryChanges(employeeId: string) {
  return useQuery({
    queryKey: accountKeys.salaryChanges(employeeId),
    queryFn: () => runAction(() => listSalaryChangesAction(employeeId)),
  });
}

/** A raise changes employees, their history and draft planillas. */
export function useApplySalaryRaise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => applySalaryRaiseAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, [employeesKeys.all, accountKeys.all, payrollKeys.all]);
    },
  });
}

// ─── Trip extras ─────────────────────────────────────────────────────────────

export function usePeriodTripExtras(
  year: number,
  month: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: accountKeys.tripExtras(year, month),
    queryFn: () => runAction(() => getPeriodTripExtrasAction(year, month)),
    enabled,
  });
}

export function useUpdateTripRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateTripRatesAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, [employeesKeys.all, accountKeys.all]);
    },
  });
}
