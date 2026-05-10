"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  configurePosAction,
  listInvoicingChannelsAction,
  loadAfipAdminAction,
  syncAfipPosAction,
} from "../actions/afip-admin-actions";
import { afipAdminKeys } from "../lib/afip-admin-keys";

export function useAfipAdminPanel() {
  return useSuspenseQuery({
    queryKey: afipAdminKeys.panel(),
    queryFn: () => runAction(() => loadAfipAdminAction()),
  });
}

export function useInvoicingChannels() {
  return useSuspenseQuery({
    queryKey: afipAdminKeys.channels(),
    // Channels rarely change; cache aggressively across the app.
    staleTime: 5 * 60_000,
    queryFn: () => runAction(() => listInvoicingChannelsAction()),
  });
}

export function useSyncAfipPos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAction(() => syncAfipPosAction()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: afipAdminKeys.panel() });
    },
  });
}

export function useConfigurePos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof configurePosAction>[0]) =>
      runAction(() => configurePosAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: afipAdminKeys.panel() });
    },
  });
}
