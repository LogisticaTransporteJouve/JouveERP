"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { INVOICE_EFFECT_KEYS } from "@/features/invoices/lib/invoice-effect-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  changeShipmentStatusAction,
  createShipmentAction,
  deleteShipmentAction,
  findShipmentRemitoConflictAction,
  invoiceFreightAction,
  listShipmentHistoryAction,
  listShipmentOptionsAction,
  listShipmentsAction,
  listShipmentsByTripAction,
  listUnassignedShipmentsAction,
  setShipmentsTripAction,
  updateShipmentAction,
} from "../actions/shipments-actions";
import { getClientFreightTariffAction } from "../actions/freight-tariff-actions";
import { shipmentsKeys } from "../lib/shipments-keys";

export function useShipments() {
  return useSuspenseQuery({
    queryKey: shipmentsKeys.list(),
    queryFn: () => runAction(() => listShipmentsAction()),
  });
}

export function useShipmentsByTrip(tripId: string | null) {
  return useQuery({
    queryKey: shipmentsKeys.byTrip(tripId ?? "none"),
    queryFn: () => runAction(() => listShipmentsByTripAction(tripId ?? "")),
    enabled: tripId !== null,
  });
}

/** Cargas without a trip, fetched when the "Asignar cargas" dialog opens. */
export function useUnassignedShipments(enabled: boolean) {
  return useQuery({
    queryKey: shipmentsKeys.unassigned(),
    queryFn: () => runAction(() => listUnassignedShipmentsAction()),
    enabled,
  });
}

export function useSetShipmentsTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { tripId: string | null; shipmentIds: string[] }) =>
      runAction(() => setShipmentsTripAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useShipmentOptions() {
  return useQuery({
    queryKey: shipmentsKeys.options(),
    queryFn: () => runAction(() => listShipmentOptionsAction()),
    staleTime: 60_000,
  });
}

/** The live carga of the client that already holds `remitoNumber`, checked
 *  while the form is open (the caller debounces the number). */
export function useShipmentRemitoConflict(check: {
  clientId: string;
  remitoNumber: string;
  excludeId: string | null;
}) {
  const remitoNumber = check.remitoNumber.trim();
  const ready = check.clientId !== "" && remitoNumber !== "";
  return useQuery({
    queryKey: shipmentsKeys.remitoConflict({ ...check, remitoNumber }),
    queryFn: () =>
      runAction(() =>
        findShipmentRemitoConflictAction({
          client_id: check.clientId,
          remito_number: remitoNumber,
          exclude_id: check.excludeId,
        }),
      ),
    enabled: ready,
    staleTime: 10_000,
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
    mutationFn: (input: unknown) =>
      runAction(() => createShipmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateShipmentAction(input)),
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

export function useInvoiceFreight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => invoiceFreightAction(input)),
    onSuccess: () => invalidateKeys(qc, INVOICE_EFFECT_KEYS),
  });
}

/** The client's flete tariff on `date`, to pre-fill a new carga's flete. */
export function useClientFreightTariff(input: {
  clientId: string;
  date: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: shipmentsKeys.freightTariff(input.clientId, input.date),
    queryFn: () =>
      runAction(() =>
        getClientFreightTariffAction({
          client_id: input.clientId,
          date: input.date,
        }),
      ),
    enabled: input.enabled && input.clientId !== "",
    staleTime: 60_000,
  });
}
