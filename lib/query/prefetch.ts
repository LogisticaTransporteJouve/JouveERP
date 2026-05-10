import {
  dehydrate,
  type FetchInfiniteQueryOptions,
  type FetchQueryOptions,
} from "@tanstack/react-query";

import { makeQueryClient } from "./query-client";

/**
 * Server-side helper used by RSC pages to prefetch one or more queries
 * before the client mounts, so the dehydrated cache hydrates the client and
 * `useSuspenseQuery` resolves synchronously without an extra fetch.
 *
 * Errors thrown by individual queries are swallowed here and logged: the
 * client hook will retry, and `error.tsx` covers the user-facing fallback.
 * If we let one failed prefetch throw, the entire RSC render aborts — and
 * the user sees the route error boundary even though the other queries
 * could have succeeded.
 *
 * Mixing in infinite queries is supported: any entry shaped like
 * `{ infinite: true, ... }` is routed through `prefetchInfiniteQuery`.
 */
export type PrefetchEntry =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | ({ infinite?: false } & FetchQueryOptions<any, any, any, any>)
  | ({ infinite: true } & FetchInfiniteQueryOptions<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >);

export async function prefetchQueries(queries: PrefetchEntry[]) {
  const queryClient = makeQueryClient();

  await Promise.all(
    queries.map((q) => {
      const fn = q.infinite
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          () => queryClient.prefetchInfiniteQuery(q as any)
        : () => queryClient.prefetchQuery(q);
      return fn().catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            "prefetchQueries: query failed (will retry on client)",
            { key: q.queryKey, err },
          );
        }
      });
    }),
  );

  return dehydrate(queryClient);
}
