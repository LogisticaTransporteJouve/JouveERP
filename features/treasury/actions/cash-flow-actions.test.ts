import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// getCashFlowAction over an in-memory client: a failed exchange-rate read
// fails the flow, and USD items left out for lack of a rate flag the result.

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let rpcRows: Record<string, Row[]> = {};
let rateRead:
  | { ok: true; rate: { rate: number; rate_date: string } | null }
  | {
      ok: false;
    } = { ok: true, rate: null };

function builder(rows: Row[]) {
  const b = {
    select: () => b,
    eq: () => b,
    gte: () => b,
    lte: () => b,
    order: () => b,
    range: async () => ({ data: rows, error: null }),
  };
  return b;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => builder(db[table] ?? []),
    rpc: (fn: string) => builder(rpcRows[fn] ?? []),
  }),
}));
vi.mock("@/lib/supabase/paginate", () => ({
  paginateRange: async (
    page: (from: number, to: number) => Promise<{ data: Row[]; error: null }>,
  ) => page(0, 999),
}));
vi.mock("@/lib/channels", () => ({
  getInvoicingChannels: async () => [{ id: "jouve_fiscal", is_fiscal: true }],
}));
vi.mock("@/lib/fx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fx")>()),
  readLatestUsdRate: async () => rateRead,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getCashFlowAction } = await import("./cash-flow-actions");

beforeEach(() => {
  db = {
    accounts: [
      {
        id: "ars",
        opening_balance: 1000,
        currency: "ARS",
        type: "bank",
        is_active: true,
      },
      {
        id: "usd",
        opening_balance: 10,
        currency: "USD",
        type: "bank",
        is_active: true,
      },
    ],
  };
  rpcRows = {};
});

describe("getCashFlowAction and the USD rate", () => {
  it("fails the whole flow when the rate read fails", async () => {
    rateRead = { ok: false };
    const res = await getCashFlowAction({});
    expect(res).toEqual({
      ok: false,
      error: "No se pudo calcular el flujo de caja.",
    });
  });

  it("flags the result when USD items are left out for lack of a rate", async () => {
    rateRead = { ok: true, rate: null };
    const res = await getCashFlowAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usdSkipped).toBe(true);
    expect(res.data.usdRate).toBeNull();
    expect(res.data.cashToday).toBe(1000);
  });

  it("converts USD at the loaded rate and does not flag", async () => {
    rateRead = { ok: true, rate: { rate: 1000, rate_date: "2026-10-31" } };
    const res = await getCashFlowAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usdSkipped).toBe(false);
    expect(res.data.cashToday).toBe(11000);
  });

  it("does not flag an ARS-only flow without a rate", async () => {
    rateRead = { ok: true, rate: null };
    db.accounts = db.accounts!.filter((a) => a.currency === "ARS");
    const res = await getCashFlowAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usdSkipped).toBe(false);
  });
});
