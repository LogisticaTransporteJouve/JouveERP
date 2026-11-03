"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  getManagementDrillAction,
  getManagementReportAction,
  logManagementExportAction,
  setManagementBucketAction,
} from "../actions/management-actions";
import { managementKeys } from "../lib/management-keys";
import type {
  ManagementDrillInput,
  ManagementExportInput,
  ManagementReportInput,
} from "../schema";

export function useManagementReport(input: ManagementReportInput) {
  return useSuspenseQuery({
    queryKey: managementKeys.report(input),
    queryFn: () => runAction(() => getManagementReportAction(input)),
  });
}

/** Not suspense: the dialog shows its own loading and error. */
export function useManagementDrill(input: ManagementDrillInput) {
  return useQuery({
    queryKey: managementKeys.drill(input),
    queryFn: () => runAction(() => getManagementDrillAction(input)),
  });
}

export function useSetManagementBucket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof setManagementBucketAction>[0]) =>
      runAction(() => setManagementBucketAction(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: managementKeys.all }),
  });
}

export function useLogManagementExport() {
  return useMutation({
    mutationFn: (input: ManagementExportInput) =>
      runAction(() => logManagementExportAction(input)),
  });
}
