"use client";

import { useCallback } from "react";

/**
 * Returns a stable `setFilters` function that merges the given key/value
 * pairs into the current URL search params, so a filtered list can be
 * reloaded or shared. The list's own state drives its queries; the URL only
 * mirrors it (the server page reads it for the first render).
 *
 * It writes with `window.history.replaceState`, which Next keeps in sync
 * with `useSearchParams` without navigating. A `router.replace` here would
 * re-render the page on the server on every keystroke and abort the list's
 * in-flight server actions, so the rows could stay on the previous filter.
 *
 * Calls that change nothing are skipped. A value of `null`, `undefined`, or
 * `""` deletes the param.
 */
export function useUrlFilter() {
  return useCallback((updates: Record<string, string | null | undefined>) => {
    const url = new URL(window.location.href);
    const params = url.searchParams;

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
    window.history.replaceState(window.history.state, "", url);
  }, []);
}
