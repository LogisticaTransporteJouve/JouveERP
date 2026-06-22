"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createExchangeRateAction,
  deleteExchangeRateAction,
  listExchangeRatesAction,
} from "../actions/exchange-rates-actions";
import { exchangeRatesKeys } from "../lib/exchange-rates-keys";

export function useExchangeRates() {
  return useSuspenseQuery({
    queryKey: exchangeRatesKeys.list(),
    queryFn: () => runAction(() => listExchangeRatesAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: exchangeRatesKeys.all });
}

export function useCreateExchangeRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createExchangeRateAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteExchangeRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteExchangeRateAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
