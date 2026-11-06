import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRole, resolveAccess } from "@/lib/auth/permissions";

const CHANNEL_FISCAL = "11111111-1111-4111-8111-111111111111";
const CHANNEL_INTERNAL = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";
const INVOICE_ID = "44444444-4444-4444-8444-444444444444";

let stored: Record<string, unknown> | null = null;
const writes: string[] = [];

function from(table: string) {
  let channelId: unknown = null;
  const builder = {
    select: () => builder,
    eq: (_col: string, value: unknown) => {
      channelId = value;
      return builder;
    },
    maybeSingle: async () => {
      if (table === "invoicing_channels") {
        return {
          data: { is_fiscal: channelId === CHANNEL_FISCAL },
          error: null,
        };
      }
      return { data: stored, error: null };
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
    // The header writes are create/update_purchase_invoice; they fail here so
    // the tests stop right after the rule let the write through.
    rpc: async (name: string) => {
      const write = {
        create_purchase_invoice: "insert:purchase_invoices",
        update_purchase_invoice: "update:purchase_invoices",
      }[name];
      if (!write) return { data: null, error: null };
      writes.push(write);
      return { data: null, error: { code: "XX000" } };
    },
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
    imp_neto: 100,
    imp_iva: 21,
    imp_trib: 0,
    imp_no_gravado: 0,
    imp_op_exentas: 40,
    imp_total: 161,
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
          "En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto: cargá el IVA en 0 y, si hay ítems, con «Sin alícuota».",
      });
      expect(writes).toEqual([]);
    },
  );

  it("reads the IVA from the items, which the items RPC writes over the header", async () => {
    const res = await createPurchaseInvoiceAction({
      ...create,
      letter: "B",
      imp_neto: 1210,
      imp_total: 1210,
      items: [
        {
          description: "Servicio",
          quantity: 1,
          unit_price: 1000,
          iva_rate_id: 5,
          line_neto: 1000,
          line_iva: 210,
          line_total: 1210,
        },
      ],
    });
    expect(res).toEqual({
      ok: false,
      error:
        "En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto: cargá el IVA en 0 y, si hay ítems, con «Sin alícuota».",
    });
    expect(writes).toEqual([]);
  });

  it("lets a fiscal A with IVA and exento through to the insert", async () => {
    await createPurchaseInvoiceAction({
      ...create,
      letter: "A",
      imp_iva: 21,
      imp_op_exentas: 10,
      imp_total: 131,
    });
    expect(writes).toEqual(["insert:purchase_invoices"]);
  });
});

describe("total rule", () => {
  const MISMATCH =
    "Los importes no suman el total: neto + IVA + otros tributos + no gravado + exento tienen que dar el total del comprobante.";

  it("refuses a create whose parts do not add up to the total", async () => {
    const res = await createPurchaseInvoiceAction({
      ...create,
      letter: "A",
      imp_neto: 1000,
      imp_iva: 210,
      imp_total: 1500,
    });
    expect(res).toEqual({ ok: false, error: MISMATCH });
    expect(writes).toEqual([]);
  });

  it("refuses an edit whose amounts, merged with the stored ones, leave a gap", async () => {
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      imp_neto: 150,
    });
    expect(res).toEqual({ ok: false, error: MISMATCH });
    expect(writes).toEqual([]);
  });

  it("checks an internal purchase too", async () => {
    stored = { ...stored, channel_id: CHANNEL_INTERNAL, letter: null };
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      imp_total: 200,
    });
    expect(res).toEqual({ ok: false, error: MISMATCH });
  });

  it("lets an old row whose total and parts differ save an edit that keeps its amounts", async () => {
    stored = { ...stored, imp_total: 451 };
    await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      imp_neto: 100,
      imp_iva: 21,
      imp_total: 451,
      notes: "revisada",
    });
    expect(writes).toEqual(["update:purchase_invoices"]);
  });

  it("lets that row through once the gap goes to no gravado", async () => {
    stored = { ...stored, imp_total: 451 };
    await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      imp_no_gravado: 290,
    });
    expect(writes).toEqual(["update:purchase_invoices"]);
  });
});

describe("letter rule and items on update", () => {
  it("refuses switching a stored A with IVA to B", async () => {
    stored = { ...stored, imp_op_exentas: 0, imp_total: 121 };
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      letter: "B",
      imp_iva: 21,
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

  it("refuses items with IVA on a stored fiscal B", async () => {
    stored = {
      ...stored,
      letter: "B",
      imp_neto: 121,
      imp_iva: 0,
      imp_op_exentas: 0,
      imp_total: 121,
    };
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      items: [
        {
          description: "Servicio",
          quantity: 1,
          unit_price: 100,
          iva_rate_id: 5,
          line_neto: 100,
          line_iva: 21,
          line_total: 121,
        },
      ],
    });
    expect(res.ok).toBe(false);
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
    stored = {
      ...stored,
      channel_id: CHANNEL_INTERNAL,
      letter: "B",
      imp_op_exentas: 0,
      imp_total: 121,
    };
    await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      letter: "B",
      imp_iva: 30,
      imp_total: 130,
    });
    expect(writes).toEqual(["update:purchase_invoices"]);
  });

  it("refuses moving an internal B with IVA to a fiscal channel", async () => {
    stored = {
      ...stored,
      channel_id: CHANNEL_INTERNAL,
      letter: "B",
      imp_op_exentas: 0,
      imp_total: 121,
    };
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      channel_id: CHANNEL_FISCAL,
      letter: "B",
      imp_iva: 21,
    });
    expect(res.ok).toBe(false);
    expect(writes).toEqual([]);
  });
});
