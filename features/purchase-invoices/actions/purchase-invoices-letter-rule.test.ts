import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRole, resolveAccess } from "@/lib/auth/permissions";

const CHANNEL_FISCAL = "11111111-1111-4111-8111-111111111111";
const CHANNEL_INTERNAL = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";
const INVOICE_ID = "44444444-4444-4444-8444-444444444444";

let stored: Record<string, unknown> | null = null;
const writes: string[] = [];

function from(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => {
      if (table === "invoicing_channels") {
        return { data: { is_fiscal: true }, error: null };
      }
      return { data: stored, error: null };
    },
    insert: () => {
      writes.push(`insert:${table}`);
      return {
        select: () => ({
          single: async () => ({ data: null, error: { code: "XX000" } }),
        }),
      };
    },
    update: () => {
      writes.push(`update:${table}`);
      return { eq: async () => ({ error: { code: "XX000" } }) };
    },
  };
  return builder;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"].filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from,
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { createPurchaseInvoiceAction, updatePurchaseInvoiceAction } =
  await import("./purchase-invoices-actions");

const create = {
  channel_id: CHANNEL_FISCAL,
  supplier_id: SUPPLIER_ID,
  kind: "factura",
  punto_venta: 1,
  numero: 10,
  fecha: "2026-09-10",
  imp_neto: 100,
  imp_total: 121,
  moneda: "PES",
  cotizacion: 1,
};

beforeEach(() => {
  writes.length = 0;
  stored = {
    channel_id: CHANNEL_FISCAL,
    letter: "A",
    imp_iva: 21,
    imp_no_gravado: 0,
    imp_op_exentas: 40,
  };
});

describe("letter rule on create", () => {
  it.each([
    ["B", { imp_iva: 21 }],
    ["C", { imp_op_exentas: 21 }],
    ["B", { imp_no_gravado: 21 }],
  ])(
    "refuses a fiscal %s with %o before inserting",
    async (letter, amounts) => {
      const res = await createPurchaseInvoiceAction({
        ...create,
        letter,
        ...amounts,
      });
      expect(res).toEqual({
        ok: false,
        error:
          "En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto.",
      });
      expect(writes).toEqual([]);
    },
  );

  it("lets a fiscal A with IVA and exento through to the insert", async () => {
    await createPurchaseInvoiceAction({
      ...create,
      letter: "A",
      imp_iva: 21,
      imp_op_exentas: 10,
    });
    expect(writes).toEqual(["insert:purchase_invoices"]);
  });
});

describe("letter rule and items on update", () => {
  it("refuses switching a stored A with IVA to B", async () => {
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      letter: "B",
    });
    expect(res.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses items without a rate against the stored exento before saving the header", async () => {
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      items: [
        {
          description: "Sin alícuota",
          quantity: 1,
          unit_price: 80,
          iva_rate_id: null,
          line_neto: 80,
          line_iva: 0,
          line_total: 80,
        },
      ],
    });
    expect(res).toEqual({
      ok: false,
      error:
        "Con exento o no gravado en el encabezado, los ítems deben tener alícuota.",
    });
    expect(writes).toEqual([]);
  });

  it("lets an unchanged old B with IVA be edited", async () => {
    stored = { ...stored, letter: "B" };
    await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      letter: "B",
      imp_iva: 21,
      notes: "ok",
    });
    expect(writes).toEqual(["update:purchase_invoices"]);
  });

  it("does not apply the rule to an internal channel", async () => {
    stored = { ...stored, channel_id: CHANNEL_INTERNAL, letter: null };
    await updatePurchaseInvoiceAction({ id: INVOICE_ID, imp_iva: 30 });
    expect(writes).toEqual(["update:purchase_invoices"]);
  });
});
