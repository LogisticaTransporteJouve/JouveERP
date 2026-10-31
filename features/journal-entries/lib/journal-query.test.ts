import { describe, expect, it, vi } from "vitest";

import { prefetchQueries } from "@/lib/query/prefetch";

import type { JournalFilters } from "../schema";
import { JOURNAL_PAGE_SIZE } from "./journal-pagination";
import { journalEntriesQuery } from "./journal-query";

const listJournalEntriesAction = vi.fn();

vi.mock("../actions/journal-entries-actions", () => ({
  listJournalEntriesAction: (input: unknown) => listJournalEntriesAction(input),
}));

const filters: JournalFilters = {
  period: "2026-10",
  sourceTable: "all",
  channelId: null,
};

describe("journalEntriesQuery", () => {
  it("dehydrates the infinite shape useSuspenseInfiniteQuery reads", async () => {
    listJournalEntriesAction.mockResolvedValue({
      ok: true,
      data: { items: [], nextOffset: null },
    });

    const state = await prefetchQueries([
      { infinite: true, ...journalEntriesQuery(filters) },
    ]);

    expect(listJournalEntriesAction).toHaveBeenCalledWith({
      ...filters,
      offset: 0,
      limit: JOURNAL_PAGE_SIZE,
    });
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]?.state.data).toEqual({
      pages: [{ items: [], nextOffset: null }],
      pageParams: [0],
    });
  });
});
