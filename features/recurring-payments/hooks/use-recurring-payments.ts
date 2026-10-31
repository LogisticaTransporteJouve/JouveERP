"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { runAction } from "@/lib/query/run-action";

import {
  createRecurringPaymentAction,
  deleteRecurringPaymentAction,
  listRecurringPaymentsAction,
  setRecurringPaymentActiveAction,
  updateRecurringPaymentAction,
} from "../actions/recurring-payments-actions";
import { recurringPaymentsKeys } from "../lib/recurring-payments-keys";

export function useRecurringPayments(options: { onlyActive?: boolean } = {}) {
  const onlyActive = options.onlyActive ?? false;
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: recurringPaymentsKeys.list(onlyActive, isFiscal),
    queryFn: () =>
      runAction(() => listRecurringPaymentsAction({ onlyActive, isFiscal })),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: recurringPaymentsKeys.all });
}

export function useCreateRecurringPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createRecurringPaymentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateRecurringPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateRecurringPaymentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetRecurringPaymentActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setRecurringPaymentActiveAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteRecurringPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteRecurringPaymentAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
