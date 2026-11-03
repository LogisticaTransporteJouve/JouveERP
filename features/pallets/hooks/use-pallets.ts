"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  blockPalletAction,
  createPalletAction,
  createPalletsBulkAction,
  deletePalletAction,
  dispatchPalletsBulkAction,
  listPalletsAction,
  listPalletBlockEventsAction,
  unblockPalletAction,
  updatePalletAction,
} from "../actions/pallets-actions";
import { palletsKeys } from "../lib/pallets-keys";
import type { PalletBlockInput, PalletUnblockInput } from "../schema";

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

export function useDispatchPalletsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => dispatchPalletsBulkAction(input)),
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

export function useBlockPallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PalletBlockInput) =>
      runAction(() => blockPalletAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUnblockPallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PalletUnblockInput) =>
      runAction(() => unblockPalletAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

/** Who blocked or unblocked the pallet; loads while `enabled`. */
export function usePalletBlockEvents(palletId: string, enabled: boolean) {
  return useQuery({
    queryKey: palletsKeys.blockEvents(palletId),
    queryFn: () => runAction(() => listPalletBlockEventsAction(palletId)),
    enabled,
  });
}

export function useDeletePallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deletePalletAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
