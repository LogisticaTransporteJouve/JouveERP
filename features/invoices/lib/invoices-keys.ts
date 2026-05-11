import type { InvoiceStatus } from "../schema";

export const INVOICES_PAGE_SIZE = 50;

/**
 * Query keys for the comprobantes feature.
 *
 * `searchInfinite` includes the filters (channel, status, query) so each
 * combination caches independently.
 *
 * `status` (used by the detail-page polling) is intentionally a leaf so
 * `invalidateQueries({ queryKey: invoicesKeys.status(id) })` only
 * touches that single row.
 */
export const invoicesKeys = {
  all: ["invoices"] as const,
  searchInfinite: (filters: {
    channel: string | null;
    status: InvoiceStatus | null;
    query: string;
  }) => [...invoicesKeys.all, "searchInfinite", filters] as const,
  detail: (id: string) => [...invoicesKeys.all, "detail", id] as const,
  status: (id: string) => [...invoicesKeys.all, "status", id] as const,
  enabledPos: (channelId: string) =>
    [...invoicesKeys.all, "enabledPos", channelId] as const,
};
