"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { checksKeys } from "@/features/checks/lib/checks-keys";
import { issuedChecksKeys } from "@/features/issued-checks/lib/issued-checks-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { purchaseInvoicesKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { getMutationId } from "@/lib/query/get-mutation-id";
import { runAction } from "@/lib/query/run-action";

import {
  cancelPaymentOrderAction,
  createPaymentOrderAction,
  getNextPaymentOrderNumeroAction,
  getPaymentOrderByIdAction,
  getPaymentOrderUsdRateAction,
  listPaymentOrdersAction,
  listPendingInvoicesForSupplierAction,
  updatePaymentOrderAction,
} from "../actions/payment-orders-actions";
import {
  paymentOrderListActionInput,
  type PaymentOrderListFilters,
} from "../lib/payment-order-list-filters";
import {
  PAYMENT_ORDERS_PAGE_SIZE,
  paymentOrdersKeys,
} from "../lib/payment-orders-keys";

export function usePaymentOrdersSearchInfinite(
  filters: PaymentOrderListFilters,
) {
  const query = useSuspenseInfiniteQuery({
    queryKey: paymentOrdersKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listPaymentOrdersAction(
          paymentOrderListActionInput(
            filters,
            pageParam,
            PAYMENT_ORDERS_PAGE_SIZE,
          ),
        ),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });

  const items = useMemo(
    () => query.data.pages.flatMap((page) => page.items),
    [query.data],
  );

  return { ...query, items };
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

/** Loaded USD rate for `date` (null: none loaded), fetched only when enabled. */
export function usePaymentOrderUsdRate(date: string, enabled: boolean) {
  return useQuery({
    queryKey: paymentOrdersKeys.usdRate(date),
    queryFn: () => runAction(() => getPaymentOrderUsdRateAction(date)),
    enabled,
  });
}

/** A payment order moves cash, settles purchase invoices (supplier account
 *  and aging), endorses or issues checks and posts a fiscal entry. */
const PAYMENT_ORDER_EFFECT_KEYS = [
  paymentOrdersKeys.all,
  ...CASH_KEYS,
  purchaseInvoicesKeys.all,
  suppliersKeys.all,
  checksKeys.all,
  issuedChecksKeys.all,
  ...LEDGER_KEYS,
] as const;

function invalidatePaymentOrderEffects(qc: ReturnType<typeof useQueryClient>) {
  invalidateKeys(qc, PAYMENT_ORDER_EFFECT_KEYS);
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
