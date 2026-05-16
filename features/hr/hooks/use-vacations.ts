"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  adjustVacationBalanceAction,
  createLeaveAction,
  deleteLeaveAction,
  grantVacationBalancesAction,
  listEmployeeLeavesAction,
  listVacationBalancesAction,
  updateLeaveAction,
} from "../actions/vacations-actions";

const vacationKeys = {
  leaves: (employeeId: string) => ["vacations", "leaves", employeeId] as const,
  balances: (employeeId: string) => ["vacations", "balances", employeeId] as const,
  all: ["vacations"] as const,
};

export function useEmployeeLeaves(employeeId: string) {
  return useQuery({
    queryKey: vacationKeys.leaves(employeeId),
    queryFn: () => runAction(() => listEmployeeLeavesAction(employeeId)),
  });
}

export function useVacationBalances(employeeId: string) {
  return useQuery({
    queryKey: vacationKeys.balances(employeeId),
    queryFn: () => runAction(() => listVacationBalancesAction(employeeId)),
  });
}

type CreateLeaveVars = {
  employee_id: string;
  start_date: string;
  end_date: string;
  kind:
    | "vacaciones"
    | "enfermedad"
    | "franco"
    | "maternidad"
    | "paternidad"
    | "otro";
  notes?: string | null;
};

export function useCreateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeaveVars) =>
      runAction(() => createLeaveAction(input)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: vacationKeys.leaves(vars.employee_id) });
      qc.invalidateQueries({ queryKey: vacationKeys.balances(vars.employee_id) });
    },
  });
}

type UpdateLeaveVars = {
  id: string;
  employee_id: string;
  start_date?: string;
  end_date?: string;
  kind?:
    | "vacaciones"
    | "enfermedad"
    | "franco"
    | "maternidad"
    | "paternidad"
    | "otro";
  notes?: string | null;
};

export function useUpdateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employee_id: _e, ...rest }: UpdateLeaveVars) =>
      runAction(() => updateLeaveAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: vacationKeys.leaves(vars.employee_id) });
      qc.invalidateQueries({ queryKey: vacationKeys.balances(vars.employee_id) });
    },
  });
}

type DeleteLeaveVars = { id: string; employee_id: string };

export function useDeleteLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteLeaveVars) =>
      runAction(() => deleteLeaveAction({ id })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: vacationKeys.leaves(vars.employee_id) });
      qc.invalidateQueries({ queryKey: vacationKeys.balances(vars.employee_id) });
    },
  });
}

export function useGrantVacationBalances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { target_year: number; carryover: boolean }) =>
      runAction(() => grantVacationBalancesAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vacationKeys.all });
    },
  });
}

type AdjustBalanceVars = {
  id: string;
  employee_id: string;
  bonus_days?: number;
  status?: "active" | "expired" | "extended";
  notes?: string | null;
};

export function useAdjustVacationBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employee_id: _e, ...rest }: AdjustBalanceVars) =>
      runAction(() => adjustVacationBalanceAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: vacationKeys.balances(vars.employee_id),
      });
    },
  });
}
