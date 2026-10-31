"use client";

import {
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { runAction } from "@/lib/query/run-action";

import { listHubUploadersAction } from "../actions/hub-actions";
import { filesKeys } from "../lib/files-keys";
import { hubFilesQuery } from "../lib/hub-query";
import type { HubFileRow, HubFilters } from "../schema";

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
