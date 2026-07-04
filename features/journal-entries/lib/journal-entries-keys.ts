import type { JournalFilters } from "../schema";

export const journalEntriesKeys = {
  all: ["journal_entries"] as const,
  list: (filters: JournalFilters) =>
    [
      ...journalEntriesKeys.all,
      "list",
      {
        period: filters.period ?? null,
        sourceTable: filters.sourceTable ?? null,
        channelId: filters.channelId ?? null,
      },
    ] as const,
  postableAccounts: () =>
    [...journalEntriesKeys.all, "postableAccounts"] as const,
};
