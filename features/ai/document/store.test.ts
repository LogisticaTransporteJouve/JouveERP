import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal service-client stand-in: update + eq/neq filters over one table.
type Row = Record<string, unknown>;
let rows: Row[] = [];

function query() {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row = {};
  const builder = {
    update: (values: Row) => {
      patch = values;
      return builder;
    },
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    },
    neq: (col: string, v: unknown) => {
      filters.push((r) => r[col] !== v);
      return builder;
    },
    then: (resolve: (v: { error: null }) => unknown) => {
      for (const r of rows.filter((x) => filters.every((f) => f(x)))) {
        Object.assign(r, patch);
      }
      return Promise.resolve(resolve({ error: null }));
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: query }),
}));
vi.mock("@/features/ai/reconciliation/gather", () => ({
  reconcileExtracto: vi.fn(),
}));

const { markExtractionFailed, saveExtractionResult } = await import("./store");

const ID = "ext-1";

beforeEach(() => {
  rows = [{ id: ID, status: "discarded", payload: null }];
});

describe("extraction write-back respects a discard", () => {
  it("saveExtractionResult does not resurrect a discarded draft", async () => {
    await saveExtractionResult(ID, {
      detectedType: "receipt",
      confidence: 0.9,
      payload: { total_amount: 1 },
      matches: {},
      status: "pending_review",
    });
    expect(rows[0]).toMatchObject({ status: "discarded", payload: null });
  });

  it("markExtractionFailed leaves a discarded draft discarded", async () => {
    await markExtractionFailed(ID);
    expect(rows[0]?.status).toBe("discarded");
  });

  it("still writes a draft that is in flight", async () => {
    rows = [{ id: ID, status: "pending_review", payload: null }];
    await saveExtractionResult(ID, {
      detectedType: "receipt",
      confidence: 0.9,
      payload: { total_amount: 1 },
      matches: {},
      status: "pending_review",
    });
    expect(rows[0]).toMatchObject({ payload: { total_amount: 1 } });
  });
});
