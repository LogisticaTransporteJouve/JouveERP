"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  applyFinalSettlementAction,
  getFinalSettlementAction,
} from "../actions/final-settlement-actions";
import { payrollKeys } from "../lib/payroll-keys";
import type { ApplyFinalSettlementInput } from "../payroll-schema";

export function useFinalSettlement(employeeId: string) {
  return useQuery({
    queryKey: payrollKeys.finalSettlement(employeeId),
    queryFn: () => runAction(() => getFinalSettlementAction(employeeId)),
  });
}

export function useApplyFinalSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyFinalSettlementInput) =>
      runAction(() => applyFinalSettlementAction(input)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: payrollKeys.periods() });
      qc.invalidateQueries({ queryKey: [...payrollKeys.all, "period"] });
      qc.invalidateQueries({ queryKey: [...payrollKeys.all, "extras"] });
      qc.invalidateQueries({
        queryKey: payrollKeys.finalSettlement(vars.employee_id),
      });
    },
  });
}
