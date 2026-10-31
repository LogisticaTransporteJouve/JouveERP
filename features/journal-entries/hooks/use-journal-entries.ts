"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { listChartOfAccountsAction } from "@/features/chart-of-accounts/actions/chart-of-accounts-actions";
import { runAction } from "@/lib/query/run-action";

import { createManualJournalEntryAction } from "../actions/journal-entries-actions";
import { journalEntriesKeys } from "../lib/journal-entries-keys";
import { JOURNAL_PAGE_SIZE } from "../lib/journal-pagination";
import { journalEntriesQuery } from "../lib/journal-query";
import type { JournalEntryWithLines, JournalFilters } from "../schema";

export { JOURNAL_PAGE_SIZE };

export function useJournalEntries(filters: JournalFilters) {
  const query = useSuspenseInfiniteQuery(journalEntriesQuery(filters));

  const items = useMemo<JournalEntryWithLines[]>(
    () => query.data.pages.flatMap((p) => p.items),
    [query.data],
  );

  return { ...query, items };
}

export function useCreateManualJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createManualJournalEntryAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalEntriesKeys.all });
    },
  });
}

/**
 * Active leaf accounts (no children) — the only valid posting targets for a
 * manual entry, sorted by code.
 */
export function usePostableAccounts(enabled: boolean) {
  const query = useQuery({
    queryKey: journalEntriesKeys.postableAccounts(),
    queryFn: () =>
      runAction(() => listChartOfAccountsAction({ onlyActive: true })),
    enabled,
    staleTime: 60_000,
  });

  const accounts = useMemo(() => {
    const all = query.data ?? [];
    const parents = new Set(
      all.map((a) => a.parent_id).filter((id): id is string => id !== null),
    );
    return all.filter((a) => !parents.has(a.id));
  }, [query.data]);

  return { ...query, accounts };
}
