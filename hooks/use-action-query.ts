"use client";

import {
  useQuery,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";

/**
 * Reads a server action that returns the standard `ActionResult<T>` envelope
 * and surfaces it through TanStack Query.
 *
 * The wrapper unboxes `{ ok: true, data }` into the query result and turns
 * `{ ok: false, error }` into a thrown `Error`, so callers can treat the
 * normal `data` / `isLoading` / `error` triplet without sprinkling `if
 * (res.ok)` checks across components.
 *
 * Convention for query keys: `[feature, operation, ...params]`. Always
 * include the params that drive the action so the cache invalidates when
 * they change. Use `enabled: false` when the params are not yet ready (e.g.
 * a clientId that hasn't been picked).
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type Options = {
  enabled?: boolean;
  staleTime?: number;
};

export function useActionQuery<T>(
  queryKey: QueryKey,
  actionFn: () => Promise<ActionResult<T>>,
  options: Options = {},
): UseQueryResult<T, Error> {
  return useQuery<T, Error>({
    queryKey,
    queryFn: async () => {
      const res = await actionFn();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: options.enabled,
    staleTime: options.staleTime,
  });
}
