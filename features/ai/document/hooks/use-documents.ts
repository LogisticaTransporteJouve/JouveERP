"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getNextPaymentOrderNumeroAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { getNextReceiptNumeroAction } from "@/features/receipts/actions/receipts-actions";
import { runAction, type ActionResult } from "@/lib/query/run-action";

import {
  createChecksFromExtractionAction,
  createPaymentOrderFromExtractionAction,
  createPurchaseInvoiceFromExtractionAction,
  createPurchaseNoteFromExtractionAction,
  createReceiptFromExtractionAction,
  createSalesInvoiceFromExtractionAction,
  discardExtractionAction,
  getExtractionAction,
  listExtractionsAction,
  scanDocumentAction,
  type PendingExtraction,
} from "../actions";
import { documentKeys } from "../lib/document-keys";

/** True while any extraction is still being processed by the pipeline. */
function anyProcessing(rows: PendingExtraction[]): boolean {
  return rows.some((r) => r.detected_type === null && r.status === "pending_review");
}

/** Extractions for a status tab. Polls while the pending tab still has work. */
export function useExtractions(status: string) {
  return useQuery({
    queryKey: documentKeys.list(status),
    queryFn: () => runAction(() => listExtractionsAction(status)),
    refetchInterval: (query) => {
      const rows = query.state.data;
      return rows && anyProcessing(rows) ? 4000 : false;
    },
  });
}

export function useExtraction(id: string | null) {
  return useQuery({
    queryKey: documentKeys.detail(id ?? "none"),
    queryFn: () => runAction(() => getExtractionAction(id ?? "")),
    enabled: id !== null,
  });
}

export function useScanDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return runAction(() => scanDocumentAction(fd));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

export function useCreatePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { extractionId: string; channelId: string }) =>
      runAction(() => createPurchaseInvoiceFromExtractionAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

export function useCreateChecksFromExtraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createChecksFromExtractionAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

export function useDiscardExtraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => discardExtractionAction(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

function useCreateFromExtraction(
  action: (input: unknown) => Promise<ActionResult<{ id: string }>>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => action(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

export function useCreateReceiptFromExtraction() {
  return useCreateFromExtraction(createReceiptFromExtractionAction);
}

export function useCreatePaymentOrderFromExtraction() {
  return useCreateFromExtraction(createPaymentOrderFromExtractionAction);
}

export function useCreatePurchaseNoteFromExtraction() {
  return useCreateFromExtraction(createPurchaseNoteFromExtractionAction);
}

export function useCreateSalesInvoiceFromExtraction() {
  return useCreateFromExtraction(createSalesInvoiceFromExtractionAction);
}

/** Next recibo/OP numero for the chosen channel (to prefill the dialog). */
export function useNextDocNumero(
  kind: "receipt" | "payment_order",
  channelId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: documentKeys.nextNumero(kind, channelId || "_none"),
    queryFn: () =>
      runAction(() =>
        kind === "receipt"
          ? getNextReceiptNumeroAction({ channel_id: channelId })
          : getNextPaymentOrderNumeroAction({ channel_id: channelId }),
      ),
    enabled: enabled && channelId.length > 0,
  });
}
