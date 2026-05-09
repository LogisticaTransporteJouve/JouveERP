"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a stable `setFilters` function that merges the given key/value
 * pairs into the current URL search params via `router.replace` (no scroll).
 *
 * Two non-obvious details that prevent infinite re-renders when consumers
 * call this from inside a `useEffect`:
 *   1. The callback identity does NOT depend on `pathname` / `searchParams`.
 *      A ref carries the latest snapshot so the function is stable across
 *      renders.
 *   2. The callback short-circuits when the proposed updates already match
 *      the current URL state. Without this, calling `router.replace` with
 *      the same URL still triggers a re-render in Next 16 App Router, and
 *      any effect that depends on the callback would loop.
 *
 * A value of `null`, `undefined`, or `""` deletes the param.
 */
export function useUrlFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const latestRef = useRef({ pathname, searchParams });
  useEffect(() => {
    latestRef.current = { pathname, searchParams };
  });

  return useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const snapshot = latestRef.current;
      const params = new URLSearchParams(snapshot.searchParams.toString());

      let changed = false;
      for (const [key, value] of Object.entries(updates)) {
        const current = params.get(key);
        const target =
          value === null || value === undefined || value === "" ? null : value;
        if (current === target) continue;
        if (target === null) params.delete(key);
        else params.set(key, target);
        changed = true;
      }

      if (!changed) return;

      const qs = params.toString();
      router.replace(
        `${snapshot.pathname}${qs ? `?${qs}` : ""}`,
        { scroll: false },
      );
    },
    [router],
  );
}
