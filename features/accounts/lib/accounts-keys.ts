/**
 * Query keys for the accounts feature. Shared between server prefetch
 * (lib/query/prefetch.ts) and client hooks so a single typo doesn't make
 * the cache miss silently.
 */
export const accountsKeys = {
  all: ["accounts"] as const,
  list: () => [...accountsKeys.all, "list"] as const,
  byId: (id: string) => [...accountsKeys.all, "byId", id] as const,
};
