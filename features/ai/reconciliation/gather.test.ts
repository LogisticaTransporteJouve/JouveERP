import { beforeEach, describe, expect, it, vi } from "vitest";

type Drain = {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
};

let lines: Drain = { data: [], error: null };
let transactions: Drain = { data: [], error: null };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/paginate", () => {
  let call = 0;
  return {
    // reconcileExtracto drains bank_statement_lines first, then transactions.
    paginateRange: async () => (call++ % 2 === 0 ? lines : transactions),
  };
});

const { reconcileExtracto } = await import("./gather");

const statement = { movements: [{ date: "2026-11-01", credit: 10 }] };

beforeEach(() => {
  lines = { data: [], error: null };
  transactions = { data: [], error: null };
});

describe("reconcileExtracto outcomes (audit w13-s6 F1)", () => {
  it("summarizes when both reads succeed", async () => {
    expect(await reconcileExtracto(statement)).toMatchObject({
      statement_total: 1,
      matched: 0,
    });
  });

  it("has nothing to summarize without movements", async () => {
    expect(await reconcileExtracto({ movements: [] })).toBeNull();
  });

  it("throws on a failed read, so the scan's step retries", async () => {
    transactions = { data: null, error: { message: "timeout" } };
    await expect(reconcileExtracto(statement)).rejects.toThrow("timeout");
  });

  it("answers too_many_rows past the cap instead of no summary", async () => {
    lines = {
      data: null,
      error: { message: "Result exceeds 5000 rows", code: "row_cap" },
    };
    expect(await reconcileExtracto(statement)).toBe("too_many_rows");
  });
});
