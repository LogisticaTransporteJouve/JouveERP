import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal service-client stand-in: update + eq/neq/is filters over one table.
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
    is: (col: string, v: unknown) => {
      filters.push((r) => (r[col] ?? null) === v);
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
    rows = [
      { id: ID, status: "pending_review", detected_type: null, payload: null },
    ];
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

describe("extraction write-back leaves a draft the pipeline no longer owns", () => {
  const save = () =>
    saveExtractionResult(ID, {
      detectedType: "receipt",
      confidence: 0.9,
      payload: { total_amount: 2 },
      matches: {},
      status: "pending_review",
    });
  const confirmed = () => ({
    id: ID,
    status: "confirmed",
    detected_type: "receipt",
    payload: { total_amount: 1 },
    created_entity: { table: "receipts", id: "r1" },
  });

  it("a retried save does not put a confirmed draft back to pending", async () => {
    rows = [confirmed()];
    await save();
    expect(rows[0]).toMatchObject({
      status: "confirmed",
      payload: { total_amount: 1 },
    });
  });

  it("a retried save does not rewrite a draft it already saved", async () => {
    rows = [
      {
        id: ID,
        status: "pending_review",
        detected_type: "receipt",
        payload: { total_amount: 1 },
      },
    ];
    await save();
    expect(rows[0]).toMatchObject({ payload: { total_amount: 1 } });
  });

  it("markExtractionFailed leaves a confirmed or saved draft alone", async () => {
    rows = [confirmed()];
    await markExtractionFailed(ID);
    expect(rows[0]?.status).toBe("confirmed");
    rows = [{ id: ID, status: "pending_review", detected_type: "receipt" }];
    await markExtractionFailed(ID);
    expect(rows[0]?.status).toBe("pending_review");
  });

  it("markExtractionFailed still fails a draft in flight", async () => {
    rows = [{ id: ID, status: "pending_review", detected_type: null }];
    await markExtractionFailed(ID);
    expect(rows[0]?.status).toBe("failed");
  });
});
