"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { managementKeys } from "@/features/management/lib/management-keys";
import { runAction } from "@/lib/query/run-action";

import {
  getAccountingSettingsAction,
  updateAccountingSettingsAction,
} from "../actions/accounting-settings-actions";
import { accountingSettingsKeys } from "../lib/accounting-settings-keys";

export function useAccountingSettings() {
  return useSuspenseQuery({
    queryKey: accountingSettingsKeys.detail(),
    queryFn: () => runAction(() => getAccountingSettingsAction()),
  });
}

export function useUpdateAccountingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { fiscalYearStartMonth: number }) =>
      runAction(() => updateAccountingSettingsAction(input)),
    onSuccess: (data) => {
      qc.setQueryData(accountingSettingsKeys.detail(), data);
      // The report reads «el ejercicio» from the setting on the server.
      qc.invalidateQueries({ queryKey: managementKeys.all });
    },
  });
}
