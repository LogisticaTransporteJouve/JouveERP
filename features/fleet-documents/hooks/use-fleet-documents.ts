"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createFleetDocumentAction,
  deleteFleetDocumentAction,
  listFleetDocumentsAction,
  updateFleetDocumentAction,
  uploadFleetDocumentFileAction,
} from "../actions/fleet-documents-actions";
import { fleetDocumentsKeys } from "../lib/fleet-documents-keys";

export function useFleetDocuments() {
  return useSuspenseQuery({
    queryKey: fleetDocumentsKeys.list(),
    queryFn: () => runAction(() => listFleetDocumentsAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: fleetDocumentsKeys.all });
}

export function useCreateFleetDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createFleetDocumentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateFleetDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateFleetDocumentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteFleetDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteFleetDocumentAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}

export function useUploadFleetDocumentFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, file }: { documentId: string; file: File }) => {
      const fd = new FormData();
      fd.append("documentId", documentId);
      fd.append("file", file);
      return runAction(() => uploadFleetDocumentFileAction(fd));
    },
    onSuccess: () => invalidate(qc),
  });
}
