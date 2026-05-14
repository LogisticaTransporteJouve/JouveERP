"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { runAction } from "@/lib/query/run-action";

import {
  cancelPurchaseInvoiceAction,
  createPurchaseInvoiceAction,
  getPurchaseInvoiceByIdAction,
  searchPurchaseInvoicesAction,
  updatePurchaseInvoiceAction,
  type SearchPurchaseInvoicesPage,
} from "../actions/purchase-invoices-actions";
import {
  PURCHASE_INVOICES_PAGE_SIZE,
  purchaseInvoicesKeys,
  type PurchaseInvoicesFilters,
} from "../lib/purchase-invoices-keys";
import type { PurchaseInvoice } from "../schema";

export { PURCHASE_INVOICES_PAGE_SIZE };

export function usePurchaseInvoicesSearchInfinite(
  filters: PurchaseInvoicesFilters,
) {
  const query = useSuspenseInfiniteQuery({
    queryKey: purchaseInvoicesKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        searchPurchaseInvoicesAction({
          query: filters.query,
          supplierId: filters.supplierId,
          channelId: filters.channelId,
          status: filters.status,
          fechaFrom: filters.fechaFrom,
          fechaTo: filters.fechaTo,
          offset: pageParam,
          limit: PURCHASE_INVOICES_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: SearchPurchaseInvoicesPage) =>
      lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<PurchaseInvoice[]>(
    () => query.data.pages.flatMap((p) => p.invoices),
    [query.data],
  );

  return { ...query, items };
}

export function usePurchaseInvoiceById(id: string) {
  return useSuspenseQuery({
    queryKey: purchaseInvoicesKeys.byId(id),
    queryFn: () => runAction(() => getPurchaseInvoiceByIdAction(id)),
  });
}

function invalidatePurchaseEffects(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: purchaseInvoicesKeys.all });
  qc.invalidateQueries({ queryKey: suppliersKeys.all });
}

export function useCreatePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createPurchaseInvoiceAction(input)),
    onSuccess: () => {
      invalidatePurchaseEffects(qc);
    },
  });
}

export function useUpdatePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updatePurchaseInvoiceAction(input)),
    onSuccess: (_data, variables) => {
      invalidatePurchaseEffects(qc);
      const id = (variables as { id?: string }).id;
      if (id) qc.invalidateQueries({ queryKey: purchaseInvoicesKeys.byId(id) });
    },
  });
}

export function useCancelPurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => cancelPurchaseInvoiceAction({ id })),
    onSuccess: () => {
      invalidatePurchaseEffects(qc);
    },
  });
}
