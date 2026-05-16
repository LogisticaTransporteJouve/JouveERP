"use client";

import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { runAction } from "@/lib/query/run-action";

import { listJournalEntriesAction } from "../actions/journal-entries-actions";
import { journalEntriesKeys } from "../lib/journal-entries-keys";
import { JOURNAL_PAGE_SIZE } from "../lib/journal-pagination";
import type { JournalEntryWithLines, JournalFilters } from "../schema";

export { JOURNAL_PAGE_SIZE };

export function useJournalEntries(filters: JournalFilters) {
  const query = useSuspenseInfiniteQuery({
    queryKey: journalEntriesKeys.list(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listJournalEntriesAction({
          ...filters,
          offset: pageParam,
          limit: JOURNAL_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: {
      items: JournalEntryWithLines[];
      nextOffset: number | null;
    }) => lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<JournalEntryWithLines[]>(
    () => query.data.pages.flatMap((p) => p.items),
    [query.data],
  );

  return { ...query, items };
}
