"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  listEnabledPosAction,
  listInvoicingChannelsAction,
} from "@/features/invoices/actions/invoices-actions";

import {
  getStorageBillingAction,
  invoiceStorageAction,
  listStorageBillingRunsAction,
} from "../actions/billing-actions";
import { storageBillingKeys } from "../lib/storage-billing-keys";

export function useStorageBilling(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: storageBillingKeys.report(periodStart, periodEnd),
    queryFn: () =>
      runAction(() => getStorageBillingAction({ periodStart, periodEnd })),
    enabled: Boolean(periodStart) && Boolean(periodEnd),
  });
}

export function useStorageBillingRuns() {
  return useQuery({
    queryKey: storageBillingKeys.runs(),
    queryFn: () => runAction(() => listStorageBillingRunsAction()),
  });
}

export function useInvoicingChannels() {
  return useQuery({
    queryKey: storageBillingKeys.channels(),
    queryFn: () => runAction(() => listInvoicingChannelsAction()),
  });
}

export function useEnabledPos(channelId: string) {
  return useQuery({
    queryKey: storageBillingKeys.pos(channelId),
    queryFn: () => runAction(() => listEnabledPosAction(channelId)),
    enabled: Boolean(channelId),
  });
}

export function useInvoiceStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => invoiceStorageAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storageBillingKeys.all });
    },
  });
}
