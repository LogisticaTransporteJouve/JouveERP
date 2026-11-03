"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  listHistoricPayrollAction,
  listHistoricTripsAction,
} from "../actions/historic-actions";
import {
  commitImportAction,
  listImportRunsAction,
  previewImportAction,
  undoImportRunAction,
} from "../actions/import-actions";
import { importsKeys } from "../lib/imports-keys";

export function useImportRuns() {
  return useSuspenseQuery({
    queryKey: importsKeys.runs(),
    queryFn: () => runAction(() => listImportRunsAction()),
  });
}

export function useHistoricPayroll(year: number) {
  return useSuspenseQuery({
    queryKey: importsKeys.historicPayroll(year),
    queryFn: () => runAction(() => listHistoricPayrollAction({ year })),
  });
}

export function useHistoricTrips(month: string) {
  return useSuspenseQuery({
    queryKey: importsKeys.historicTrips(month),
    queryFn: () => runAction(() => listHistoricTripsAction({ month })),
  });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: (formData: FormData) =>
      runAction(() => previewImportAction(formData)),
  });
}

/** An import or its undo touches clients, suppliers, employees, drivers or
 *  vehicles: every cached list is refetched. */
export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      runAction(() => commitImportAction(formData)),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useUndoImportRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => undoImportRunAction({ id })),
    onSuccess: () => qc.invalidateQueries(),
  });
}
