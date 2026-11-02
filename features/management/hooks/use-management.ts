"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  getManagementReportAction,
  setManagementBucketAction,
} from "../actions/management-actions";
import { managementKeys } from "../lib/management-keys";
import type { ManagementReportInput } from "../schema";

export function useManagementReport(input: ManagementReportInput) {
  return useSuspenseQuery({
    queryKey: managementKeys.report(input),
    queryFn: () => runAction(() => getManagementReportAction(input)),
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
