import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRole, resolveAccess } from "@/lib/auth/permissions";

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
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles.filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: query }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { findPurchaseInvoiceDuplicateAction, getPurchaseInvoiceOpenAction } =
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

describe("getPurchaseInvoiceOpenAction", () => {
  beforeEach(() => {
    rows = [
      {
        purchase_invoice_id: "pi-1",
        amount_paid: "21",
        amount_credited_by_nc: "60",
        amount_opening_applied: "10",
        open_amount: "30",
      },
    ];
  });

  it("reads the open amount of the one purchase, NCs and opening included", async () => {
    const res = await getPurchaseInvoiceOpenAction("pi-1");
    expect(res).toEqual({
      ok: true,
      data: { paid: 21, credited: 60, opening_applied: 10, open_amount: 30 },
    });
    expect(filters).toEqual([["purchase_invoice_id", "pi-1"]]);
  });

  it("refuses a role that cannot read OPs, whose read would count none", async () => {
    roles = ["fiscal_reader"];
    const res = await getPurchaseInvoiceOpenAction("pi-1");
    expect(res.ok).toBe(false);
    expect(filters).toEqual([]);
  });

  it("fails instead of answering zero when no row comes back", async () => {
    const res = await getPurchaseInvoiceOpenAction("pi-2");
    expect(res).toEqual({ ok: false, error: "No se pudieron leer los pagos." });
  });
});
