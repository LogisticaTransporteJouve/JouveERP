"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { checksKeys } from "@/features/checks/lib/checks-keys";
import { issuedChecksKeys } from "@/features/issued-checks/lib/issued-checks-keys";
import { purchaseInvoicesKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { getMutationId } from "@/lib/query/get-mutation-id";
import { runAction } from "@/lib/query/run-action";

import {
  cancelPaymentOrderAction,
  createPaymentOrderAction,
  getNextPaymentOrderNumeroAction,
  getPaymentOrderByIdAction,
  listPaymentOrdersAction,
  listPendingInvoicesForSupplierAction,
  updatePaymentOrderAction,
} from "../actions/payment-orders-actions";
import { paymentOrdersKeys } from "../lib/payment-orders-keys";

export function usePaymentOrdersList() {
  return useSuspenseQuery({
    queryKey: paymentOrdersKeys.list(),
    queryFn: () => runAction(() => listPaymentOrdersAction()),
  });
}

export function usePaymentOrderDetail(
  id: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: paymentOrdersKeys.detail(id),
    queryFn: () => runAction(() => getPaymentOrderByIdAction(id)),
    enabled: options.enabled,
  });
}

export function usePendingPurchaseInvoices(
  supplierId: string | null,
  channelId: string | null,
  excludePaymentOrderId?: string,
) {
  return useQuery({
    queryKey: paymentOrdersKeys.pendingInvoices(
      supplierId ?? "_none",
      channelId ?? "_none",
      excludePaymentOrderId,
    ),
    queryFn: () =>
      supplierId && channelId
        ? runAction(() =>
            listPendingInvoicesForSupplierAction(
              supplierId,
              channelId,
              excludePaymentOrderId,
            ),
          )
        : Promise.resolve([]),
    enabled: !!supplierId && !!channelId,
    staleTime: 5_000,
  });
}

export function useNextPaymentOrderNumero(channelId: string | null) {
  const query = useQuery({
    queryKey: paymentOrdersKeys.nextNumero(channelId ?? "_none"),
    queryFn: () =>
      runAction(() =>
        getNextPaymentOrderNumeroAction({ channel_id: channelId ?? "" }),
      ),
    enabled: !!channelId,
  });

  return {
    next: query.data?.next ?? null,
    isFirst: query.data?.isFirst ?? false,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

function invalidatePaymentOrderEffects(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: paymentOrdersKeys.all });
  qc.invalidateQueries({ queryKey: transactionsKeys.all });
  qc.invalidateQueries({ queryKey: purchaseInvoicesKeys.all });
  qc.invalidateQueries({ queryKey: suppliersKeys.all });
  qc.invalidateQueries({ queryKey: checksKeys.all });
  qc.invalidateQueries({ queryKey: issuedChecksKeys.all });
}

export function useCreatePaymentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createPaymentOrderAction(input)),
    onSuccess: () => {
      invalidatePaymentOrderEffects(qc);
    },
  });
}

export function useUpdatePaymentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updatePaymentOrderAction(input)),
    onSuccess: (_data, variables) => {
      invalidatePaymentOrderEffects(qc);
      const id = getMutationId(variables);
      if (id) qc.invalidateQueries({ queryKey: paymentOrdersKeys.detail(id) });
    },
  });
}

export function useCancelPaymentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) =>
      runAction(() => cancelPaymentOrderAction(input)),
    onSuccess: (_data, variables) => {
      invalidatePaymentOrderEffects(qc);
      qc.invalidateQueries({
        queryKey: paymentOrdersKeys.detail(variables.id),
      });
    },
  });
}
