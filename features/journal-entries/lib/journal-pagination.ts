import type { JournalEntryWithLines } from "../schema";

export const JOURNAL_PAGE_SIZE = 50;

export type JournalPage = {
  items: JournalEntryWithLines[];
  nextOffset: number | null;
};
