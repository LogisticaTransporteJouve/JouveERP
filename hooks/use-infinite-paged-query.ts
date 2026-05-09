"use client";

import {
  useInfiniteQuery,
  type QueryKey,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * Standard "fetch a page, give me the next offset" infinite query. The
 * `queryFn` receives the current offset (defaults to 0 on first page) and
 * must return `{ items, nextOffset }`. `nextOffset === null` ends the
 * pagination.
 *
 * The hook flattens `query.data.pages` into a single `items` array so
 * callers don't have to reach into the page structure.
 */
export type Page<T> = {
  items: T[];
  nextOffset: number | null;
};

type Options<T> = {
  queryKey: QueryKey;
  queryFn: (offset: number) => Promise<Page<T>>;
  enabled?: boolean;
  staleTime?: number;
};

export type InfinitePagedQueryResult<T> = UseInfiniteQueryResult<
  { pages: Page<T>[]; pageParams: number[] },
  Error
> & {
  items: T[];
};

export function useInfinitePagedQuery<T>(
  options: Options<T>,
): InfinitePagedQueryResult<T> {
  const query = useInfiniteQuery<
    Page<T>,
    Error,
    { pages: Page<T>[]; pageParams: number[] },
    QueryKey,
    number
  >({
    queryKey: options.queryKey,
    queryFn: ({ pageParam }) => options.queryFn(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: options.enabled,
    staleTime: options.staleTime,
  });

  const items = useMemo<T[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return { ...query, items };
}
