import type { ComprobanteStatus } from "../schema";

export const COMPROBANTES_PAGE_SIZE = 50;

/**
 * Query keys for the comprobantes feature.
 *
 * `searchInfinite` includes the filters (channel, status, query) so each
 * combination caches independently.
 *
 * `status` (used by the detail-page polling) is intentionally a leaf so
 * `invalidateQueries({ queryKey: comprobantesKeys.status(id) })` only
 * touches that single row.
 */
export const comprobantesKeys = {
  all: ["comprobantes"] as const,
  searchInfinite: (filters: {
    channel: string | null;
    status: ComprobanteStatus | null;
    query: string;
  }) => [...comprobantesKeys.all, "searchInfinite", filters] as const,
  detail: (id: string) => [...comprobantesKeys.all, "detail", id] as const,
  status: (id: string) => [...comprobantesKeys.all, "status", id] as const,
  enabledPos: (channelId: string) =>
    [...comprobantesKeys.all, "enabledPos", channelId] as const,
};
