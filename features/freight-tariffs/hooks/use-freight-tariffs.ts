"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  applyFreightTariffIncreaseAction,
  createFreightTariffListAction,
  deleteFreightTariffListAction,
  deleteFreightTariffVersionAction,
  listFreightTariffsAction,
  saveFreightTariffVersionAction,
  updateFreightTariffListAction,
} from "../actions/freight-tariffs-actions";
import { freightTariffsKeys } from "../lib/freight-tariffs-keys";
import type {
  FreightTariffIncreaseInput,
  FreightTariffListCreateInput,
  FreightTariffListUpdateInput,
  FreightTariffVersionSaveInput,
} from "../schema";

export function useFreightTariffs() {
  return useSuspenseQuery({
    queryKey: freightTariffsKeys.list(),
    queryFn: () => runAction(() => listFreightTariffsAction()),
  });
}

function useWrite<I, O>(action: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSettled: () => qc.invalidateQueries({ queryKey: freightTariffsKeys.all }),
  });
}

export function useCreateFreightTariffList() {
  return useWrite((input: FreightTariffListCreateInput) =>
    runAction(() => createFreightTariffListAction(input)),
  );
}

export function useUpdateFreightTariffList() {
  return useWrite((input: FreightTariffListUpdateInput) =>
    runAction(() => updateFreightTariffListAction(input)),
  );
}

export function useDeleteFreightTariffList() {
  return useWrite((id: string) =>
    runAction(() => deleteFreightTariffListAction({ id })),
  );
}

export function useSaveFreightTariffVersion() {
  return useWrite((input: FreightTariffVersionSaveInput) =>
    runAction(() => saveFreightTariffVersionAction(input)),
  );
}

export function useDeleteFreightTariffVersion() {
  return useWrite((id: string) =>
    runAction(() => deleteFreightTariffVersionAction({ id })),
  );
}

export function useApplyFreightTariffIncrease() {
  return useWrite((input: FreightTariffIncreaseInput) =>
    runAction(() => applyFreightTariffIncreaseAction(input)),
  );
}
