"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUrlFilter } from "@/hooks/use-url-filter";

type UrlParams = Record<string, string | null>;

function sameUrl(a: UrlParams, b: UrlParams): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return true;
}

/**
 * State of a list screen's filters, mirrored into the URL. `params` is what
 * the controls show; `committed` is what the query uses (the search box, when
 * the list has one, debounced). `reset` clears every filter but keeps the `viewKeys` (e.g. the
 * Lista / Por día toggle), and `isFiltered` says whether any filter differs
 * from `defaults`. `toUrl` must be a module-level function.
 */
export function useListParams<P extends object>({
  initial,
  defaults,
  toUrl,
  viewKeys = [],
}: {
  initial: P;
  defaults: P;
  toUrl: (params: P) => UrlParams;
  viewKeys?: readonly (keyof P)[];
}) {
  const [params, setParams] = useState<P>(initial);
  const rawQuery =
    "query" in params && typeof params.query === "string" ? params.query : null;
  const debouncedQuery = useDebouncedValue(rawQuery?.trim() ?? "", 250);
  const committed = useMemo<P>(
    () => (rawQuery === null ? params : { ...params, query: debouncedQuery }),
    [params, rawQuery, debouncedQuery],
  );

  const setUrlFilters = useUrlFilter();
  useEffect(() => {
    setUrlFilters(toUrl(committed));
  }, [committed, toUrl, setUrlFilters]);

  const update = useCallback((patch: Partial<P>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setParams((prev) => {
      const next = { ...defaults };
      for (const key of viewKeys) next[key] = prev[key];
      return next;
    });
  }, [defaults, viewKeys]);

  const isFiltered = useMemo(() => {
    const view = { ...params };
    for (const key of viewKeys) view[key] = defaults[key];
    return !sameUrl(toUrl(view), toUrl(defaults));
  }, [params, defaults, toUrl, viewKeys]);

  return { params, committed, update, reset, isFiltered };
}
