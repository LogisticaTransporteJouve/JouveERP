import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Invalidates every root in `keys`; the lists below group the roots one
 *  write changes, so a mutation names the group instead of repeating it.
 *  Resolves once the active queries refetched: a mutation that returns it
 *  from onSettled stays pending until the screen shows the new data. */
export function invalidateKeys(
  qc: QueryClient,
  keys: readonly QueryKey[],
): Promise<void> {
  return Promise.all(
    keys.map((queryKey) => qc.invalidateQueries({ queryKey })),
  ).then(() => undefined);
}
