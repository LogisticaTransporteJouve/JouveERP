"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { INVOICE_EFFECT_KEYS } from "@/features/invoices/lib/invoice-effect-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import { listInvoicingChannelsAction } from "@/features/invoices/actions/invoices-actions";

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

export function useInvoiceStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => invoiceStorageAction(input)),
    // Settled: the factura can be issued and then fail to link, and the
    // lists must still show the new comprobante and the claim.
    onSettled: () => invalidateKeys(qc, INVOICE_EFFECT_KEYS),
  });
}
