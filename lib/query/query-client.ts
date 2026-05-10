import { QueryClient } from "@tanstack/react-query";

/**
 * Defaults used by both the client-side QueryClientProvider and any
 * server-side prefetch QueryClient. Keeping a single factory avoids drift
 * between the dehydrated state from RSC and the hydrated client cache —
 * mismatched staleTime / retry behaviour silently breaks suspense
 * fallbacks.
 *
 * `staleTime: 30_000` means freshly-prefetched data does not refetch on
 * mount (avoids the post-hydration "flash" against just-prefetched data).
 * Per-feature hooks may override with their own staleTime when the read is
 * known to be more or less volatile.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
