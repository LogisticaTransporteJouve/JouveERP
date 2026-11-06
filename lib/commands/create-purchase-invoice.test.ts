import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseInvoiceCreateSchema } from "@/features/purchase-invoices/schema";

const rpc = vi.fn();
const channel = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: channel }) }),
    }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { createPurchaseInvoice } = await import("./create-purchase-invoice");

const SUPPLIER = "00000000-0000-4000-8000-000000000001";

function invoice(over: Record<string, unknown> = {}) {
  return PurchaseInvoiceCreateSchema.parse({
    channel_id: "jouve_fiscal",
    supplier_id: SUPPLIER,
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 55,
    fecha: "2026-11-02",
    imp_neto: 1000,
    imp_iva: 210,
    imp_total: 1210,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  channel.mockResolvedValue({ data: { is_fiscal: true }, error: null });
});

describe("createPurchaseInvoice", () => {
  it("saves header and items in one call and audits it", async () => {
    rpc.mockResolvedValue({ data: "pi-1", error: null });
    const res = await createPurchaseInvoice("u1", invoice());
    expect(res).toEqual({ ok: true, data: { id: "pi-1" } });
    expect(rpc).toHaveBeenCalledWith(
      "create_purchase_invoice",
      expect.objectContaining({
        p_header: expect.objectContaining({ created_by: "u1", numero: 55 }),
        p_items: [],
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "purchase_invoice.created",
      "u1",
      expect.objectContaining({ supplier_id: SUPPLIER, imp_total: 1210 }),
      "pi-1",
    );
  });

  it("refuses IVA on a fiscal B before writing", async () => {
    const res = await createPurchaseInvoice("u1", invoice({ letter: "B" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("facturas B y C");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names a duplicate in the user's words", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    const res = await createPurchaseInvoice("u1", invoice());
    expect(res).toEqual({
      ok: false,
      error:
        "Ya cargaste esta factura del proveedor (mismo tipo / letra / PV / número).",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
