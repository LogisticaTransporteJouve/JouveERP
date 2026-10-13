import { describe, expect, it } from "vitest";

import { chunk, fetchInChunks, paginateRange, type Page } from "./paginate";

/** Simulates PostgREST: serves `[from, to]` of `rows`, capped at `maxRows`. */
function server(rows: number[], maxRows = 1000) {
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number): Promise<Page<number>> => {
    calls.push([from, to]);
    const len = Math.min(to - from + 1, maxRows);
    return { data: rows.slice(from, from + len), error: null };
  };
  return { calls, fetchPage };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("paginateRange", () => {
  it("drains every row past the 1000 cap, in order", async () => {
    const rows = range(2500);
    const s = server(rows);
    const res = await paginateRange(s.fetchPage);
    expect(res.error).toBeNull();
    expect(res.data).toEqual(rows);
    expect(s.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ]);
  });

  it("issues one extra (empty) request when the total is an exact multiple", async () => {
    const s = server(range(2000));
    const res = await paginateRange(s.fetchPage);
    expect(res.data).toHaveLength(2000);
    expect(s.calls).toHaveLength(3);
  });

  it("stops on the empty page after a short one", async () => {
    const s = server(range(3));
    const res = await paginateRange(s.fetchPage);
    expect(res.data).toEqual([0, 1, 2]);
    expect(s.calls).toEqual([
      [0, 999],
      [3, 1002],
    ]);
  });

  it("still drains everything when the server caps below the page size", async () => {
    const rows = range(1200);
    const s = server(rows, 500);
    const res = await paginateRange(s.fetchPage);
    expect(res.data).toEqual(rows);
  });

  it("errors instead of growing past maxRows", async () => {
    const s = server(range(3000));
    const res = await paginateRange(s.fetchPage, 1000, 2500);
    expect(res.data).toBeNull();
    expect(res.error?.code).toBe("row_cap");
  });

  it("handles an empty result and a null data payload", async () => {
    const res = await paginateRange(async () => ({ data: null, error: null }));
    expect(res).toEqual({ data: [], error: null });
  });

  it("returns the error and no rows when a later page fails", async () => {
    let n = 0;
    const res = await paginateRange<number>(async () => {
      n += 1;
      if (n === 2)
        return { data: null, error: { message: "timeout", code: "57014" } };
      return { data: range(1000), error: null };
    });
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ message: "timeout", code: "57014" });
  });
});

describe("chunk", () => {
  it("splits into slices of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects non-positive sizes", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("fetchInChunks", () => {
  it("dedupes ids, chunks them and concatenates in chunk order", async () => {
    const seen: number[][] = [];
    const res = await fetchInChunks(
      [1, 2, 2, 3, 4, 5],
      async (ids) => {
        seen.push(ids);
        return { data: ids.map((i) => i * 10), error: null };
      },
      2,
    );
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
    expect(res.data).toEqual([10, 20, 30, 40, 50]);
  });

  it("skips the request entirely for an empty id list", async () => {
    let called = false;
    const res = await fetchInChunks<string, string>([], async () => {
      called = true;
      return { data: [], error: null };
    });
    expect(called).toBe(false);
    expect(res).toEqual({ data: [], error: null });
  });

  it("fails as a whole when any chunk fails", async () => {
    const res = await fetchInChunks(
      [1, 2, 3],
      async (ids) =>
        ids[0] === 3
          ? { data: null, error: { message: "boom" } }
          : { data: ids, error: null },
      2,
    );
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("boom");
  });
});
