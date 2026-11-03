"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { listInvoicingChannelsAction } from "@/features/invoices/actions/invoices-actions";
import { INVOICE_EFFECT_KEYS } from "@/features/invoices/lib/invoice-effect-keys";
import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  cancelFreightSettlementAction,
  confirmFreightSettlementAction,
  getFreightSettlementAction,
  invoiceFreightSettlementAction,
  listFreightSettlementCandidatesAction,
  listFreightSettlementsAction,
  saveFreightSettlementAction,
} from "../actions/freight-settlements-actions";
import { freightSettlementsKeys } from "../lib/freight-settlements-keys";
import type {
  FreightSettlementInvoiceInput,
  FreightSettlementSaveInput,
} from "../schema";

export function useFreightSettlements() {
  return useSuspenseQuery({
    queryKey: freightSettlementsKeys.list(),
    queryFn: () => runAction(() => listFreightSettlementsAction()),
  });
}

export function useFreightSettlement(id: string | null) {
  return useQuery({
    queryKey: freightSettlementsKeys.detail(id ?? "none"),
    queryFn: () => runAction(() => getFreightSettlementAction(id ?? "")),
    enabled: id !== null,
  });
}

/** The cargas a liquidación of this client and period can take; waits for
 *  a client and both dates. */
export function useFreightSettlementCandidates(input: {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  settlementId: string | null;
}) {
  const ready =
    input.clientId !== "" &&
    input.periodStart !== "" &&
    input.periodEnd !== "" &&
    input.periodStart <= input.periodEnd;
  return useQuery({
    queryKey: freightSettlementsKeys.candidates(input),
    queryFn: () =>
      runAction(() =>
        listFreightSettlementCandidatesAction({
          client_id: input.clientId,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          settlement_id: input.settlementId,
        }),
      ),
    enabled: ready,
  });
}

export function useInvoicingChannels(enabled: boolean) {
  return useQuery({
    queryKey: freightSettlementsKeys.channels(),
    queryFn: () => runAction(() => listInvoicingChannelsAction()),
    enabled,
    staleTime: 60_000,
  });
}

// A liquidación holds cargas (the shipments list shows them billed or not).
const SETTLEMENT_KEYS = [
  freightSettlementsKeys.all,
  shipmentsKeys.all,
] as const;

export function useSaveFreightSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FreightSettlementSaveInput) =>
      runAction(() => saveFreightSettlementAction(input)),
    onSuccess: () => invalidateKeys(qc, SETTLEMENT_KEYS),
  });
}

export function useConfirmFreightSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => confirmFreightSettlementAction({ id })),
    onSuccess: () => invalidateKeys(qc, SETTLEMENT_KEYS),
  });
}

export function useCancelFreightSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => cancelFreightSettlementAction({ id })),
    onSuccess: () => invalidateKeys(qc, INVOICE_EFFECT_KEYS),
  });
}

export function useInvoiceFreightSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FreightSettlementInvoiceInput) =>
      runAction(() => invoiceFreightSettlementAction(input)),
    onSuccess: () => invalidateKeys(qc, INVOICE_EFFECT_KEYS),
  });
}
