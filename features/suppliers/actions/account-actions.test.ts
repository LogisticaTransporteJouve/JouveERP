import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

// getSupplierAccountAction over an in-memory supplier: an opening balance
// row makes its currency's balance jump to its target, one row per currency;
// setSupplierOpeningBalanceAction hands the dollar target to the RPC.

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

const rpc = vi.fn(async (_fn: string, _args: Row) => ({ error: null }));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, rpc }),
}));
vi.mock("@/lib/supabase/paginate", () => ({
  paginateRange: async (
    page: (from: number, to: number) => Promise<{ data: Row[]; error: null }>,
  ) => page(0, 999),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getSupplierAccountAction, setSupplierOpeningBalanceAction } =
  await import("./account-actions");

const SUPPLIER = "7a2d3c4b-5e6f-4a70-8b9c-0d1e2f3a4b5c";

function movement(over: Row): Row {
  return {
    supplier_id: SUPPLIER,
    created_at: `${over.movement_date as string}T12:00:00+00:00`,
    letter: null,
    punto_venta: 9,
    channel_id: "jouve_internal",
    channel_name: "Jouve interno",
    channel_is_fiscal: false,
    ...over,
  };
}

function opening(currency: "ARS" | "USD", target: number): Row {
  return movement({
    source_type: "opening_balance",
    source_id: null,
    kind: "opening_balance",
    currency,
    numero: null,
    punto_venta: null,
    movement_date: "2026-10-31",
    signed_amount: target,
    gross_amount: target,
    channel_id: null,
    channel_name: null,
    channel_is_fiscal: null,
  });
}

function seed(usdTarget: number | null) {
  db.v_supplier_account_movements = [
    movement({
      source_type: "purchase_invoice",
      source_id: "p-old",
      kind: "factura",
      currency: "ARS",
      numero: 1,
      movement_date: "2026-10-01",
      signed_amount: 1000,
      gross_amount: 1000,
    }),
    movement({
      source_type: "purchase_invoice",
      source_id: "u-old",
      kind: "factura",
      currency: "USD",
      numero: 2,
      movement_date: "2026-10-02",
      signed_amount: 700,
      gross_amount: 700,
    }),
    opening("ARS", 0),
    ...(usdTarget === null ? [] : [opening("USD", usdTarget)]),
    movement({
      source_type: "purchase_invoice",
      source_id: "u-new",
      kind: "factura",
      currency: "USD",
      numero: 3,
      movement_date: "2026-11-02",
      signed_amount: 30,
      gross_amount: 30,
    }),
  ];
  db.payment_order_allocations = [];
  db.payment_order_rejected_check_allocations = [];
  db.v_supplier_rejected_check_open = [];
  db.v_purchase_invoice_open = [
    {
      supplier_id: SUPPLIER,
      purchase_invoice_id: "u-new",
      open_amount: 30,
      invoice_origin_id: null,
    },
  ];
}

describe("getSupplierAccountAction opening balance", () => {
  it("jumps each currency's balance to its own target", async () => {
    seed(0);
    const res = await getSupplierAccountAction(SUPPLIER);
    if (!res.ok) throw new Error(res.error);
    expect(
      res.data.movements.map((m) => [
        m.source_id,
        m.currency,
        m.signed_amount,
        m.balance,
      ]),
    ).toEqual([
      ["p-old", "ARS", 1000, 1000],
      ["u-old", "USD", 700, 700],
      [null, "ARS", -1000, 0],
      [null, "USD", -700, 0],
      ["u-new", "USD", 30, 30],
    ]);
    expect(res.data.balances).toEqual({ ARS: 0, USD: 30 });
  });

  it("without a dollar target the dollars run on", async () => {
    seed(null);
    const res = await getSupplierAccountAction(SUPPLIER);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.balances).toEqual({ ARS: 0, USD: 730 });
  });

  it("under a scope, each opening row shows its target", async () => {
    seed(250);
    const res = await getSupplierAccountAction(SUPPLIER, { isFiscal: false });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.runningBalance).toBe(false);
    expect(
      res.data.movements
        .filter((m) => m.source_type === "opening_balance")
        .map((m) => [m.currency, m.signed_amount, m.balance]),
    ).toEqual([
      ["ARS", 0, null],
      ["USD", 250, null],
    ]);
  });

  it("under a scope, openings at 0 keep the side's Saldo", async () => {
    seed(0);
    const res = await getSupplierAccountAction(SUPPLIER, { isFiscal: false });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.runningBalance).toBe(true);
    expect(res.data.movements.at(-1)?.balance).toBe(30);
  });
});

describe("setSupplierOpeningBalanceAction", () => {
  const input = {
    supplier_id: SUPPLIER,
    opening_date: "2026-10-31",
    target_balance: 0,
  };

  it("passes the dollar target to the RPC", async () => {
    rpc.mockClear();
    const res = await setSupplierOpeningBalanceAction({
      ...input,
      target_balance_usd: 0,
    });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("apply_supplier_opening_balance", {
      p_supplier_id: SUPPLIER,
      p_opening_date: "2026-10-31",
      p_target_balance: 0,
      p_notes: undefined,
      p_target_balance_usd: 0,
    });
  });

  it("leaves the dollar target out when there is none", async () => {
    rpc.mockClear();
    await setSupplierOpeningBalanceAction(input);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_target_balance_usd: undefined,
    });
  });

  it("refuses a negative dollar target before the RPC", async () => {
    rpc.mockClear();
    const res = await setSupplierOpeningBalanceAction({
      ...input,
      target_balance_usd: -1,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
