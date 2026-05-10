import {
  HydrationBoundary,
  type DehydratedState,
} from "@tanstack/react-query";

/**
 * Tiny re-export wrapper. Centralises the import path so RSC pages don't
 * have to know the package internals; if we ever swap the cache hydration
 * mechanism (e.g. a custom serializer for Date instances) it lives here.
 */
export function Hydrate({
  state,
  children,
}: {
  state: DehydratedState;
  children: React.ReactNode;
}) {
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>;
}
