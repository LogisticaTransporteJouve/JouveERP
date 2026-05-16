"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { searchGlobalAction } from "../actions/search-actions";
import { searchKeys } from "../lib/search-keys";

export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: searchKeys.query(query),
    queryFn: () => runAction(() => searchGlobalAction({ query })),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
}
