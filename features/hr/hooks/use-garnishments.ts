"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createGarnishmentAction,
  deleteGarnishmentAction,
  listGarnishmentsAction,
  updateGarnishmentAction,
} from "../actions/garnishments-actions";
import { payrollKeys } from "../lib/payroll-keys";

export function useEmployeeGarnishments(employeeId: string) {
  return useQuery({
    queryKey: payrollKeys.garnishments(employeeId),
    queryFn: () => runAction(() => listGarnishmentsAction(employeeId)),
  });
}

/** A garnishment write also changes the embargo of draft planillas. */
function useGarnishmentMutation<TInput, TOut>(
  employeeId: string,
  fn: (input: TInput) => Promise<TOut>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.garnishments(employeeId) });
      qc.invalidateQueries({ queryKey: [...payrollKeys.all, "period"] });
    },
  });
}

export function useCreateGarnishment(employeeId: string) {
  return useGarnishmentMutation(employeeId, (input: unknown) =>
    runAction(() => createGarnishmentAction(input)),
  );
}

export function useUpdateGarnishment(employeeId: string) {
  return useGarnishmentMutation(employeeId, (input: unknown) =>
    runAction(() => updateGarnishmentAction(input)),
  );
}

export function useDeleteGarnishment(employeeId: string) {
  return useGarnishmentMutation(employeeId, (id: string) =>
    runAction(() => deleteGarnishmentAction({ id })),
  );
}
