"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createStorageTariffAction,
  deleteStorageTariffAction,
  listStorageTariffsAction,
  setStorageTariffActiveAction,
  updateStorageTariffAction,
} from "../actions/storage-tariffs-actions";
import { storageTariffsKeys } from "../lib/storage-tariffs-keys";

export function useStorageTariffs() {
  return useSuspenseQuery({
    queryKey: storageTariffsKeys.list(),
    queryFn: () => runAction(() => listStorageTariffsAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: storageTariffsKeys.all });
}

export function useCreateStorageTariff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createStorageTariffAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateStorageTariff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateStorageTariffAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetStorageTariffActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setStorageTariffActiveAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteStorageTariff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteStorageTariffAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
