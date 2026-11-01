import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

// getClientAccountAction over an in-memory client: one running balance per
// currency, the rejected check as debt with its open amount, and a receipt's
// "a cuenta" net of what it settled of rejected checks.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  const builder = {
    select: () => builder,
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    },
    order: () => builder,
    range: async () => ({
      data: (db[table] ?? []).filter((r) => filters.every((f) => f(r))),
      error: null,
    }),
  };
  return builder;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/supabase/paginate", () => ({
  paginateRange: async (
    page: (from: number, to: number) => Promise<{ data: Row[]; error: null }>,
  ) => page(0, 999),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getClientAccountAction } = await import("./account-actions");

const CLIENT = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function movement(over: Row): Row {
  return {
    client_id: CLIENT,
    created_at: `${over.movement_date as string}T12:00:00+00:00`,
    letter: null,
    punto_venta: 3,
    numero: 1,
    channel_id: "jouve_fiscal",
    channel_name: "Jouve fiscal",
    channel_is_fiscal: true,
    ...over,
  };
}

function seed() {
  db.v_client_account_movements = [
    movement({
      source_type: "invoice",
      source_id: "fa",
      movement_date: "2026-10-01",
      kind: "factura",
      signed_amount: 1000,
      gross_amount: 1000,
      currency: "ARS",
    }),
    movement({
      source_type: "invoice",
      source_id: "fu",
      movement_date: "2026-10-02",
      kind: "factura",
      signed_amount: 50,
      gross_amount: 50,
      currency: "USD",
    }),
    movement({
      source_type: "receipt",
      source_id: "r1",
      movement_date: "2026-10-03",
      kind: "receipt",
      signed_amount: -1000,
      gross_amount: 1000,
      currency: "ARS",
    }),
    movement({
      source_type: "rejected_check",
      source_id: "k1",
      movement_date: "2026-10-04",
      kind: "rejected_check",
      signed_amount: 400,
      gross_amount: 400,
      currency: "ARS",
    }),
    movement({
      source_type: "receipt",
      source_id: "r2",
      movement_date: "2026-10-05",
      kind: "receipt",
      signed_amount: -300,
      gross_amount: 300,
      currency: "ARS",
    }),
  ];
  db.receipt_allocations = [
    {
      id: "a1",
      receipt_id: "r1",
      amount_applied: 1000,
      receipts: { status: "issued" },
      "receipts.client_id": CLIENT,
    },
  ];
  db.receipt_rejected_check_allocations = [
    {
      id: "c1",
      receipt_id: "r2",
      amount_applied: 250,
      receipts: { status: "issued" },
      "receipts.client_id": CLIENT,
    },
  ];
  db.v_aging_documents = [
    {
      client_id: CLIENT,
      document_id: "fu",
      open_amount: 50,
      channel_is_fiscal: true,
      moneda: "DOL",
    },
    {
      client_id: CLIENT,
      document_id: "k1",
      open_amount: 150,
      channel_is_fiscal: true,
      moneda: "PES",
    },
  ];
}

describe("getClientAccountAction", () => {
  it("keeps one running balance per currency", async () => {
    seed();
    const res = await getClientAccountAction(CLIENT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(
      res.data.movements.map((m) => [m.source_id, m.currency, m.balance]),
    ).toEqual([
      ["fa", "ARS", 1000],
      ["fu", "USD", 50],
      ["r1", "ARS", 0],
      ["k1", "ARS", 400],
      ["r2", "ARS", 100],
    ]);
    expect(res.data.balances).toEqual({ ARS: 100, USD: 50 });
  });

  it("orders same-day documents by number before computing the balance", async () => {
    seed();
    db.v_client_account_movements = [
      movement({
        source_type: "invoice",
        source_id: "f2",
        kind: "factura",
        currency: "ARS",
        numero: 2,
        movement_date: "2026-10-01",
        created_at: "2026-10-01T00:00:00Z",
        signed_amount: 200,
        gross_amount: 200,
      }),
      movement({
        source_type: "invoice",
        source_id: "f1",
        kind: "factura",
        currency: "ARS",
        numero: 1,
        movement_date: "2026-10-01",
        created_at: "2026-10-01T00:00:00Z",
        signed_amount: 100,
        gross_amount: 100,
      }),
    ];
    const res = await getClientAccountAction(CLIENT);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.movements.map((m) => [m.source_id, m.balance])).toEqual([
      ["f1", 100],
      ["f2", 300],
    ]);
  });

  it("shows the rejected check's open amount and the receipt's a cuenta net of it", async () => {
    seed();
    const res = await getClientAccountAction(CLIENT);
    if (!res.ok) throw new Error(res.error);
    const byId = new Map(res.data.movements.map((m) => [m.source_id, m]));
    expect(byId.get("k1")?.outstanding).toBe(150);
    expect(byId.get("r2")?.outstanding).toBe(50);
    expect(byId.get("r1")?.outstanding).toBe(0);
  });

  it("under a scope, balances are the open documents minus a cuenta, per currency", async () => {
    seed();
    const res = await getClientAccountAction(CLIENT, { isFiscal: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.runningBalance).toBe(false);
    expect(res.data.balances).toEqual({ ARS: 100, USD: 50 });
    expect(res.data.movements.every((m) => m.balance === null)).toBe(true);
  });
});
