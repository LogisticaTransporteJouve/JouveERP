export const CLIENTS_PAGE_SIZE = 50;

/**
 * Query keys for the clients feature.
 *
 * `searchInfinite` is the main listing's keyspace — keys include the
 * filters so each (query, onlyActive) combo has its own cache slot, and
 * useDeferredValue can keep the previous slot's data on screen while the
 * new one is fetching.
 *
 * `search` is the picker keyspace — separate from the table's listing so
 * an active picker doesn't poison the table cache (and vice versa).
 */
export const clientsKeys = {
  all: ["clients"] as const,
  searchInfinite: (filters: {
    query: string;
    onlyActive: boolean;
    isFiscal: boolean | null;
  }) => [...clientsKeys.all, "searchInfinite", filters] as const,
  search: (filters: {
    query: string;
    onlyActive: boolean;
    limit: number;
    isFiscal: boolean | null;
  }) => [...clientsKeys.all, "search", filters] as const,
  byId: (id: string) => [...clientsKeys.all, "byId", id] as const,
  references: (id: string) => [...clientsKeys.all, "references", id] as const,
  account: (id: string) => [...clientsKeys.all, "account", id] as const,
  accountByScope: (id: string, isFiscal: boolean | null) =>
    [...clientsKeys.account(id), { isFiscal }] as const,
  openingBalance: (id: string) =>
    [...clientsKeys.all, "openingBalance", id] as const,
};
