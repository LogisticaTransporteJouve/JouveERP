"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { listJournalEntriesAction } from "../actions/journal-entries-actions";
import { journalEntriesKeys } from "../lib/journal-entries-keys";
import type { JournalFilters } from "../schema";

export function useJournalEntries(filters: JournalFilters) {
  return useSuspenseQuery({
    queryKey: journalEntriesKeys.list(filters),
    queryFn: () => runAction(() => listJournalEntriesAction(filters)),
  });
}

export function useJournalEntriesList(filters: JournalFilters) {
  return useQuery({
    queryKey: journalEntriesKeys.list(filters),
    queryFn: () => runAction(() => listJournalEntriesAction(filters)),
    placeholderData: (prev) => prev,
  });
}
