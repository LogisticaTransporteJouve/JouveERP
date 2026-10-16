import { beforeEach, describe, expect, it, vi } from "vitest";

let roles: string[] = ["owner"];
let rows: Record<string, unknown>[] = [];
const filters: Array<[string, unknown]> = [];

function query() {
  const builder = {
    select: () => builder,
    eq: (col: string, value: unknown) => {
      filters.push([col, value]);
      return builder;
    },
    limit: () => builder,
    maybeSingle: async () => ({
      data: rows.find((r) => filters.every(([col, v]) => r[col] === v)) ?? null,
      error: null,
    }),
  };
  return builder;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", roles }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: query }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { findPurchaseInvoiceDuplicateAction } =
  await import("./purchase-invoices-actions");

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const lookup = {
  supplier_id: SUPPLIER_ID,
  kind: "factura",
  punto_venta: 3,
  numero: 120,
};

beforeEach(() => {
  roles = ["owner"];
  filters.length = 0;
  rows = [
    {
      id: "pi-1",
      supplier_id: SUPPLIER_ID,
      kind: "factura",
      letter: "A",
      punto_venta: 3,
      numero: 120,
      status: "received",
    },
  ];
});

describe("findPurchaseInvoiceDuplicateAction", () => {
  it("finds the same supplier + type + PV + número, whatever the letter", async () => {
    const res = await findPurchaseInvoiceDuplicateAction(lookup);
    expect(res).toEqual({
      ok: true,
      data: {
        id: "pi-1",
        kind: "factura",
        letter: "A",
        punto_venta: 3,
        numero: 120,
        status: "received",
      },
    });
    expect(filters.map(([col]) => col)).toEqual([
      "supplier_id",
      "kind",
      "punto_venta",
      "numero",
    ]);
  });

  it("returns null when the number is free", async () => {
    const res = await findPurchaseInvoiceDuplicateAction({
      ...lookup,
      numero: 121,
    });
    expect(res).toEqual({ ok: true, data: null });
  });

  it("does not treat an NC with the same number as a duplicate invoice", async () => {
    const res = await findPurchaseInvoiceDuplicateAction({
      ...lookup,
      kind: "nc",
    });
    expect(res).toEqual({ ok: true, data: null });
  });

  it("rejects an incomplete lookup", async () => {
    const res = await findPurchaseInvoiceDuplicateAction({
      ...lookup,
      numero: 0,
    });
    expect(res.ok).toBe(false);
  });

  it.each([["warehouse"], ["driver"], ["operations"]])(
    "is refused without purchase_invoices:read (%s)",
    async (role) => {
      roles = [role];
      const res = await findPurchaseInvoiceDuplicateAction(lookup);
      expect(res.ok).toBe(false);
      expect(filters).toHaveLength(0);
    },
  );
});
