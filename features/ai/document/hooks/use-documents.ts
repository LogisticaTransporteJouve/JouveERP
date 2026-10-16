"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { getNextPaymentOrderNumeroAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { getNextReceiptNumeroAction } from "@/features/receipts/actions/receipts-actions";
import type { PurchaseInvoiceDraft } from "@/features/purchase-invoices/lib/purchase-invoice-draft";
import { runAction, type ActionResult } from "@/lib/query/run-action";

import {
  createChecksFromExtractionAction,
  createPaymentOrderFromExtractionAction,
  createPurchaseInvoiceFromDraftAction,
  createReceiptFromExtractionAction,
  createSalesInvoiceFromExtractionAction,
  discardExtractionAction,
  getExtractionAction,
  getPurchaseInvoiceDraftAction,
  listExtractionsAction,
  scanDocumentAction,
  type PendingExtraction,
} from "../actions";
import { documentKeys } from "../lib/document-keys";
import type { DocumentKind } from "../types";

/** True while any extraction is still being processed by the pipeline. */
function anyProcessing(rows: PendingExtraction[]): boolean {
  return rows.some(
    (r) => r.detected_type === null && r.status === "pending_review",
  );
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

export function useScanDocument(declaredType?: DocumentKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      if (declaredType) fd.append("declaredType", declaredType);
      return runAction(() => scanDocumentAction(fd));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

/** Polling cap: past this the draft stays in Documentos for later review. */
export const DRAFT_POLL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Purchase-invoice draft of an extraction. While it is still processing it
 * polls, until `pollUntil` (epoch ms) when given.
 */
export function usePurchaseInvoiceDraft(
  extractionId: string | null,
  pollUntil?: number,
) {
  return useQuery({
    queryKey: documentKeys.purchaseDraft(extractionId ?? "none"),
    queryFn: () =>
      runAction(() => getPurchaseInvoiceDraftAction(extractionId ?? "")),
    enabled: extractionId !== null,
    refetchInterval: (query) =>
      query.state.data?.state === "processing" &&
      (pollUntil === undefined || Date.now() < pollUntil)
        ? 2000
        : false,
  });
}

/**
 * The save path of a purchase-invoice draft built from an extraction: the
 * invoice is created, the scanned file attached and the draft confirmed.
 */
export function useSubmitPurchaseInvoiceDraft(
  extractionId: string,
): PurchaseInvoiceDraft["submitCreate"] {
  const qc = useQueryClient();
  return useCallback(
    async (invoice) => {
      const created = await runAction(() =>
        createPurchaseInvoiceFromDraftAction({ extractionId, invoice }),
      );
      await qc.invalidateQueries({ queryKey: documentKeys.all });
      return created;
    },
    [extractionId, qc],
  );
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
    mutationFn: (id: string) => runAction(() => discardExtractionAction(id)),
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
