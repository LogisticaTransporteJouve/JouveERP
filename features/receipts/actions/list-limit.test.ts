import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// The list's page size is bounded (PostgREST stops at max_rows and a cut
// page would read as complete), and `nextOffset` counts the raw rows.

let ranges: [number, number][] = [];
let rows: unknown[] = [];
let ilikes: unknown[][] = [];

function builder(): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: rows, error: null }).then(resolve);
        }
        return (...args: unknown[]) => {
          if (prop === "range") ranges.push([Number(args[0]), Number(args[1])]);
          if (prop === "ilike") ilikes.push(args);
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => builder() }),
}));

const { listReceiptsAction } = await import("./receipts-actions");

beforeEach(() => {
  ranges = [];
  rows = [];
  ilikes = [];
});

describe("listReceiptsAction page size", () => {
  it("caps a huge limit at 200 and says more may follow", async () => {
    rows = Array.from({ length: 200 }, () => ({ id: "x" }));
    const res = await listReceiptsAction({ limit: 5000 });
    expect(ranges).toEqual([[0, 199]]);
    expect(res.ok && res.data.nextOffset).toBe(200);
  });

  it("raises a zero or negative limit to one row", async () => {
    await listReceiptsAction({ limit: 0 });
    await listReceiptsAction({ limit: -3 });
    expect(ranges).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});

describe("listReceiptsAction name search", () => {
  it("takes % and _ in the name literally", async () => {
    await listReceiptsAction({ query: "100%_sa" });
    expect(ilikes).toEqual([["clients.legal_name", "%100\\%\\_sa%"]]);
  });
});
