// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/use-journal-entries", () => ({
  useJournalEntries: () => ({
    items: [],
    isFetching: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}));
vi.mock("./journal-filters", () => ({ JournalFiltersBar: () => null }));
vi.mock("./manual-entry-dialog", () => ({ ManualEntryDialog: () => null }));
vi.mock("./closed-periods-dialog", () => ({ ClosedPeriodsDialog: () => null }));

const { JournalList } = await import("./journal-list");

afterEach(cleanup);

describe("JournalList: Nuevo asiento follows canWrite", () => {
  it.each([true, false])("canWrite %s shows Nuevo asiento: %s", (canWrite) => {
    render(
      <JournalList
        channels={[]}
        initialFilters={{
          period: "2026-10",
          sourceTable: "all",
          channelId: null,
        }}
        canManagePeriods={false}
        canWrite={canWrite}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Nuevo asiento/ }) !== null,
    ).toBe(canWrite);
  });
});
