import type { TransactionFilters } from "../schema";

/**
 * Query keys for the transactions feature.
 *
 * `list` includes the full filter object so each filter combo caches
 * independently. `byId` is used for edit dialogs.
 */
export const transactionsKeys = {
  all: ["transactions"] as const,
  list: (filters: TransactionFilters) =>
    [...transactionsKeys.all, "list", filters] as const,
  byId: (id: string) => [...transactionsKeys.all, "byId", id] as const,
  picker: (filters: TransactionFilters) =>
    [...transactionsKeys.all, "picker", filters] as const,
};
