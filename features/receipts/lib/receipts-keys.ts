import type { ListGroup } from "@/lib/list-period";

import type { ReceiptListFilters } from "./receipt-list-filters";

/** Rows per page of the receipts list (the page prefetch and the hook). */
export const RECEIPTS_PAGE_SIZE = 50;

/**
 * Query keys for the receipts feature. `searchInfinite` and `totals` carry
 * the list filters (built by `receiptListFilters` on the server prefetch and
 * in the table alike), so each combination caches on its own.
 */
export const receiptsKeys = {
  all: ["receipts"] as const,
  searchInfinite: (filters: ReceiptListFilters) =>
    [...receiptsKeys.all, "searchInfinite", filters] as const,
  totals: (filters: ReceiptListFilters, group: ListGroup | null) =>
    [...receiptsKeys.all, "totals", filters, group] as const,
  detail: (id: string) => [...receiptsKeys.all, "detail", id] as const,
  nextNumero: (channelId: string) =>
    [...receiptsKeys.all, "nextNumero", channelId] as const,
  usdRate: (date: string) => [...receiptsKeys.all, "usdRate", date] as const,
  pendingComprobantes: (
    clientId: string,
    channelId: string,
    excludeReceiptId?: string,
  ) =>
    [
      ...receiptsKeys.all,
      "pendingComprobantes",
      clientId,
      channelId,
      excludeReceiptId ?? null,
    ] as const,
};
