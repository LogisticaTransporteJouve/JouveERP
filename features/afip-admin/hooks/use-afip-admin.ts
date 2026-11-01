"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  configurePosAction,
  getArcaReconciliationAction,
  getCaeaStatusAction,
  listInvoicingChannelsAction,
  loadAfipAdminAction,
  requestArcaSyncAction,
  requestCaeaNowAction,
  syncAfipPosAction,
} from "../actions/afip-admin-actions";
import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";

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
      // The emission form lists the enabled POS per channel.
      qc.invalidateQueries({ queryKey: [...invoicesKeys.all, "enabledPos"] });
    },
  });
}

export function useCaeaStatus() {
  return useSuspenseQuery({
    queryKey: afipAdminKeys.caea(),
    queryFn: () => runAction(() => getCaeaStatusAction()),
  });
}

export function useRequestCaea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAction(() => requestCaeaNowAction()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: afipAdminKeys.caea() });
    },
  });
}

export function useRequestArcaSync() {
  return useMutation({
    mutationFn: () => runAction(() => requestArcaSyncAction()),
  });
}

/** On demand: each run asks ARCA for every (pv, tipo) last number. */
export function useArcaReconciliation(enabled: boolean) {
  return useQuery({
    queryKey: afipAdminKeys.reconciliation(),
    queryFn: () => runAction(() => getArcaReconciliationAction()),
    enabled,
    staleTime: 0,
  });
}
