"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { libroIvaKeys } from "@/features/libro-iva/lib/libro-iva-keys";
import { paymentOrdersKeys } from "@/features/payment-orders/lib/payment-orders-keys";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { getMutationId } from "@/lib/query/get-mutation-id";
import { runAction } from "@/lib/query/run-action";

import {
  cancelPurchaseInvoiceAction,
  createPurchaseInvoiceAction,
  findPurchaseInvoiceDuplicateAction,
  getPurchaseInvoiceByIdAction,
  getPurchaseInvoiceItemsAction,
  searchPurchaseInvoicesAction,
  updatePurchaseInvoiceAction,
  type SearchPurchaseInvoicesPage,
} from "../actions/purchase-invoices-actions";
import {
  PURCHASE_INVOICES_PAGE_SIZE,
  purchaseInvoicesKeys,
  type PurchaseInvoiceDuplicateLookup,
  type PurchaseInvoicesFilters,
  type PurchaseInvoicesPickerFilters,
} from "../lib/purchase-invoices-keys";
import type {
  PurchaseInvoiceCreateRawInput,
  PurchaseInvoiceDraft,
} from "../lib/purchase-invoice-draft";
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
          isFiscal: filters.isFiscal,
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

export function usePurchaseInvoiceItems(
  id: string | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: purchaseInvoicesKeys.items(id ?? ""),
    queryFn: () => runAction(() => getPurchaseInvoiceItemsAction(id ?? "")),
    enabled: !!id && options.enabled !== false,
  });
}

export function usePurchaseInvoiceByIdOptional(
  id: string | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: purchaseInvoicesKeys.byId(id ?? ""),
    queryFn: () => runAction(() => getPurchaseInvoiceByIdAction(id ?? "")),
    enabled: !!id && options.enabled !== false,
  });
}

export function usePurchaseInvoicesSearch(
  filters: PurchaseInvoicesPickerFilters,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: purchaseInvoicesKeys.search(filters),
    queryFn: () =>
      runAction(() =>
        searchPurchaseInvoicesAction({
          query: filters.query,
          supplierId: filters.supplierId,
          channelId: filters.channelId,
          kind: filters.kind,
          excludeId: filters.excludeId,
          status: filters.status,
          offset: 0,
          limit: filters.limit,
        }),
      ),
    enabled: options.enabled,
    placeholderData: (prev) => prev,
  });
}

/** Same supplier + type + PV + número already loaded (null lookup = skip). */
export function usePurchaseInvoiceDuplicate(
  lookup: PurchaseInvoiceDuplicateLookup | null,
) {
  return useQuery({
    queryKey: purchaseInvoicesKeys.duplicate(
      lookup ?? { supplier_id: "", kind: "", punto_venta: 0, numero: 0 },
    ),
    queryFn: () => runAction(() => findPurchaseInvoiceDuplicateAction(lookup)),
    enabled: lookup !== null,
    staleTime: 30_000,
  });
}

/** A purchase invoice changes the supplier's account and aging, the payment
 *  order picker, the purchases VAT book and its fiscal entry. */
const PURCHASE_EFFECT_KEYS = [
  purchaseInvoicesKeys.all,
  suppliersKeys.all,
  paymentOrdersKeys.all,
  libroIvaKeys.all,
  ...LEDGER_KEYS,
] as const;

function invalidatePurchaseEffects(qc: ReturnType<typeof useQueryClient>) {
  invalidateKeys(qc, PURCHASE_EFFECT_KEYS);
}

/**
 * Creates a purchase invoice. `submit` replaces the default save (a draft from
 * a document saves through its own path); invalidation is the same.
 */
export function useCreatePurchaseInvoice(
  submit?: PurchaseInvoiceDraft["submitCreate"],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PurchaseInvoiceCreateRawInput) =>
      submit
        ? submit(input)
        : runAction(() => createPurchaseInvoiceAction(input)),
    // Settled, not success: the header can be saved even when its items fail.
    onSettled: () => {
      invalidatePurchaseEffects(qc);
    },
  });
}

export function useUpdatePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updatePurchaseInvoiceAction(input)),
    onSettled: (_data, _error, variables) => {
      invalidatePurchaseEffects(qc);
      const id = getMutationId(variables);
      if (id) {
        qc.invalidateQueries({ queryKey: purchaseInvoicesKeys.byId(id) });
        qc.invalidateQueries({ queryKey: purchaseInvoicesKeys.items(id) });
      }
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
