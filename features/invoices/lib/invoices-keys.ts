import type { ListGroup } from "@/lib/list-period";

import type { InvoiceListFilters } from "./invoice-list-filters";

export const INVOICES_PAGE_SIZE = 50;

/**
 * Query keys for the comprobantes feature.
 *
 * `searchInfinite` and `totals` include the filters (scope, status, query,
 * kind, letter, punto de venta, client, resolved dates) so each combination
 * caches independently. The page prefetch and the table build them with
 * `invoiceListFilters` from the same URL and `isFiscalFor(scope)`.
 *
 * `status` (used by the detail-page polling) is intentionally a leaf so
 * `invalidateQueries({ queryKey: invoicesKeys.status(id) })` only
 * touches that single row.
 */
export const invoicesKeys = {
  all: ["invoices"] as const,
  searchInfinite: (filters: InvoiceListFilters) =>
    [...invoicesKeys.all, "searchInfinite", filters] as const,
  totals: (filters: InvoiceListFilters, group: ListGroup | null) =>
    [...invoicesKeys.all, "totals", filters, group] as const,
  detail: (id: string) => [...invoicesKeys.all, "detail", id] as const,
  status: (id: string) => [...invoicesKeys.all, "status", id] as const,
  enabledPos: (channelId: string) =>
    [...invoicesKeys.all, "enabledPos", channelId] as const,
  originSearch: (query: string) =>
    [...invoicesKeys.all, "originSearch", query] as const,
};
