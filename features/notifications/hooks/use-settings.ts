"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  getMyNotificationSettingsAction,
  upsertNotificationSettingAction,
} from "../actions/settings-actions";

const SETTINGS_KEY = ["notifications", "settings"] as const;

export function useNotificationSettings() {
  return useSuspenseQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => runAction(() => getMyNotificationSettingsAction()),
  });
}

export function useUpsertNotificationSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; enabled: boolean }) =>
      runAction(() => upsertNotificationSettingAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}
