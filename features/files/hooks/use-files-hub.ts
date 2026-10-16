"use client";

import {
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { runAction } from "@/lib/query/run-action";

import {
  listHubFilesAction,
  listHubUploadersAction,
} from "../actions/hub-actions";
import { filesKeys } from "../lib/files-keys";
import type { HubCursor } from "../lib/hub";
import type { HubFileRow, HubFilesPage, HubFilters } from "../schema";

export const HUB_PAGE_SIZE = 50;

export function hubFilesQuery(filters: HubFilters) {
  return {
    queryKey: filesKeys.hub(filters),
    queryFn: ({ pageParam }: { pageParam: HubCursor | null }) =>
      runAction(() =>
        listHubFilesAction({
          ...filters,
          cursor: pageParam,
          limit: HUB_PAGE_SIZE,
        }),
      ),
    initialPageParam: null,
    getNextPageParam: (last: HubFilesPage) => last.nextCursor ?? undefined,
  };
}

export function useHubFiles(filters: HubFilters) {
  const query = useSuspenseInfiniteQuery(hubFilesQuery(filters));
  const items = useMemo<HubFileRow[]>(
    () => query.data.pages.flatMap((page) => page.items),
    [query.data],
  );
  return { ...query, items };
}

export function useHubUploaders() {
  return useSuspenseQuery({
    queryKey: filesKeys.hubUploaders(),
    queryFn: () => runAction(() => listHubUploadersAction()),
    staleTime: 5 * 60_000,
  });
}
