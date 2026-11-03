import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// The 14-day agenda: a section whose read fails is reported by name instead
// of disappearing, so the card never shows an error as "sin vencimientos".

let failing = new Set<string>();

function builder(table: string): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const res = failing.has(table)
            ? { data: null, error: { message: "timeout" } }
            : { data: [], error: null };
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(res).then(resolve);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));

const { getDashboardDueDatesAction } = await import("./dashboard-actions");

beforeEach(() => {
  failing = new Set();
});

describe("getDashboardDueDatesAction", () => {
  it("names the sections whose read failed", async () => {
    failing = new Set(["checks", "loan_installments"]);
    const res = await getDashboardDueDatesAction();
    expect(res).toEqual({
      ok: true,
      data: {
        items: [],
        failed: ["cheques en cartera", "cuotas de préstamos"],
      },
    });
  });

  it("reports no failure when every read succeeds", async () => {
    const res = await getDashboardDueDatesAction();
    expect(res).toEqual({ ok: true, data: { items: [], failed: [] } });
  });
});
