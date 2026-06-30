"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createChecksFromExtractionAction,
  createPurchaseInvoiceFromExtractionAction,
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
