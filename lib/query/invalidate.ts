import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Invalidates every root in `keys`; the lists below group the roots one
 *  write changes, so a mutation names the group instead of repeating it. */
export function invalidateKeys(qc: QueryClient, keys: readonly QueryKey[]) {
  for (const queryKey of keys) qc.invalidateQueries({ queryKey });
}
