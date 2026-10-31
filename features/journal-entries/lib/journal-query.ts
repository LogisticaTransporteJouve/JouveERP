import { runAction } from "@/lib/query/run-action";

import { listJournalEntriesAction } from "../actions/journal-entries-actions";
import type { JournalFilters } from "../schema";
import { journalEntriesKeys } from "./journal-entries-keys";
import { JOURNAL_PAGE_SIZE, type JournalPage } from "./journal-pagination";

/**
 * Shared by the page prefetch and `useJournalEntries`: the server must
 * dehydrate the same infinite shape (`{ pages, pageParams }`) the client
 * reads under this key.
 */
export function journalEntriesQuery(filters: JournalFilters) {
  return {
    queryKey: journalEntriesKeys.list(filters),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      runAction(() =>
        listJournalEntriesAction({
          ...filters,
          offset: pageParam,
          limit: JOURNAL_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: JournalPage) =>
      lastPage.nextOffset ?? undefined,
  };
}
