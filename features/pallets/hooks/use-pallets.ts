"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createPalletAction,
  createPalletsBulkAction,
  deletePalletAction,
  listPalletsAction,
  updatePalletAction,
} from "../actions/pallets-actions";
import { palletsKeys } from "../lib/pallets-keys";

export function usePallets() {
  return useSuspenseQuery({
    queryKey: palletsKeys.list(),
    queryFn: () => runAction(() => listPalletsAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: palletsKeys.all });
}

export function useCreatePallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createPalletAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useCreatePalletsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createPalletsBulkAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdatePallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updatePalletAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeletePallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deletePalletAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
