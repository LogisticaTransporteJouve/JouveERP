import { dehydrate, type FetchQueryOptions } from "@tanstack/react-query";

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
 * Usage:
 *   const dehydratedState = await prefetchQueries([
 *     { queryKey: accountsKeys.list(), queryFn: () => runAction(listAccountsAction) },
 *     ...
 *   ]);
 *
 *   return (
 *     <Hydrate state={dehydratedState}>
 *       <Suspense fallback={<Skeleton />}>...</Suspense>
 *     </Hydrate>
 *   );
 */
export async function prefetchQueries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queries: FetchQueryOptions<any, any, any, any>[],
) {
  const queryClient = makeQueryClient();

  await Promise.all(
    queries.map((q) =>
      queryClient.fetchQuery(q).catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            "prefetchQueries: query failed (will retry on client)",
            { key: q.queryKey, err },
          );
        }
      }),
    ),
  );

  return dehydrate(queryClient);
}
