"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  changeShipmentStatusAction,
  createShipmentAction,
  deleteShipmentAction,
  listShipmentHistoryAction,
  listShipmentOptionsAction,
  listShipmentsAction,
  updateShipmentAction,
} from "../actions/shipments-actions";
import { shipmentsKeys } from "../lib/shipments-keys";

export function useShipments() {
  return useSuspenseQuery({
    queryKey: shipmentsKeys.list(),
    queryFn: () => runAction(() => listShipmentsAction()),
  });
}

export function useShipmentOptions() {
  return useQuery({
    queryKey: shipmentsKeys.options(),
    queryFn: () => runAction(() => listShipmentOptionsAction()),
    staleTime: 60_000,
  });
}

export function useShipmentHistory(id: string | null) {
  return useQuery({
    queryKey: shipmentsKeys.history(id ?? "none"),
    queryFn: () => runAction(() => listShipmentHistoryAction(id ?? "")),
    enabled: id !== null,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: shipmentsKeys.all });
}

export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createShipmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateShipmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useChangeShipmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => changeShipmentStatusAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteShipmentAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
