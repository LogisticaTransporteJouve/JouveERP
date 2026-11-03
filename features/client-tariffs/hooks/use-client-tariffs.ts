"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { freightSettlementsKeys } from "@/features/freight-settlements/lib/freight-settlements-keys";
import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { storageBillingKeys } from "@/features/storage-billing/lib/storage-billing-keys";
import { runAction } from "@/lib/query/run-action";

import {
  createClientTariffAction,
  deleteClientTariffAction,
  listClientTariffsAction,
  updateClientTariffAction,
} from "../actions/client-tariffs-actions";
import { clientTariffsKeys } from "../lib/client-tariffs-keys";
import type {
  ClientTariffCreateInput,
  ClientTariffUpdateInput,
} from "../schema";

export function useClientTariffs(clientId: string) {
  return useSuspenseQuery({
    queryKey: clientTariffsKeys.byClient(clientId),
    queryFn: () => runAction(() => listClientTariffsAction(clientId)),
  });
}

// A tariff changes what the storage billing preview charges, the flete a new
// carga is prefilled with and the liquidación candidates' prices.
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: clientTariffsKeys.all }),
    qc.invalidateQueries({ queryKey: storageBillingKeys.all }),
    qc.invalidateQueries({ queryKey: shipmentsKeys.all }),
    qc.invalidateQueries({ queryKey: freightSettlementsKeys.all }),
  ]);
}

export function useCreateClientTariff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientTariffCreateInput) =>
      runAction(() => createClientTariffAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateClientTariff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientTariffUpdateInput) =>
      runAction(() => updateClientTariffAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteClientTariff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteClientTariffAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
