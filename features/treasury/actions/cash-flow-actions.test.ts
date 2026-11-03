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
    lt: () => b,
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

describe("getCashFlowAction and amounts on account", () => {
  const firstProjected = () => {
    const now = new Date();
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return d.toISOString().slice(0, 7);
  };

  beforeEach(() => {
    rateRead = { ok: true, rate: null };
    db.accounts = db.accounts!.filter((a) => a.currency === "ARS");
    db.loans = [];
    db.loan_installments = [];
    db.recurring_payments = [];
  });

  it("nets an unapplied receipt off the projected collections, capped at them", async () => {
    db.v_aging_documents = [
      {
        open_amount: 1000,
        channel_is_fiscal: true,
        fch_vto_pago: "2020-01-01",
        fecha: "2020-01-01",
        moneda: "PES",
      },
    ];
    db.v_receipt_unapplied = [
      { unapplied_amount: 300, channel_is_fiscal: true, currency: "ARS" },
      // Interno has nothing projected: its credit nets nothing.
      { unapplied_amount: 50, channel_is_fiscal: false, currency: "ARS" },
    ];
    const res = await getCashFlowAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const first = res.data.months.find((m) => m.month === firstProjected());
    expect(first?.inTotal).toBe(700);
    expect(first?.inFacturado).toBe(700);
    expect(first?.inInterno).toBe(0);
  });

  it("nets an unapplied OP off the projected payments", async () => {
    db.v_supplier_aging_documents = [
      {
        open_amount: 400,
        channel_is_fiscal: false,
        fch_vto_pago: null,
        fecha: "2020-01-01",
        moneda: "PES",
      },
    ];
    db.v_payment_order_unapplied = [
      { unapplied_amount: 900, channel_is_fiscal: false, currency: "ARS" },
    ];
    const res = await getCashFlowAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const first = res.data.months.find((m) => m.month === firstProjected());
    expect(first?.outTotal).toBe(0);
  });
});

describe("getCashFlowAction and loans", () => {
  const firstProjected = () => {
    const now = new Date();
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return d.toISOString().slice(0, 7);
  };

  beforeEach(() => {
    rateRead = { ok: true, rate: null };
    db.accounts = db.accounts!.filter((a) => a.currency === "ARS");
    db.loans = [{ id: "l1", currency: "ARS", channel_id: "jouve_fiscal" }];
  });

  it("projects an overdue unpaid installment in the first projected month", async () => {
    db.loan_installments = [
      { id: "i1", loan_id: "l1", due_date: "2020-01-10", amount: 500 },
    ];
    const res = await getCashFlowAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const first = res.data.months.find((m) => m.month === firstProjected());
    expect(first?.outTotal).toBe(500);
  });

  it("does not count a recurring “Préstamo” next to a loaded loan twice", async () => {
    db.loan_installments = [];
    db.recurring_payments = [
      {
        id: "r1",
        amount: 700,
        currency: "ARS",
        frequency: "monthly",
        next_due_date: `${firstProjected()}-05`,
        end_date: null,
        channel_id: "jouve_fiscal",
        category: "prestamo",
      },
    ];
    const res = await getCashFlowAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.months.every((m) => m.realized || m.outTotal === 0)).toBe(
      true,
    );
  });
});
