import { describe, expect, it } from "vitest";

import {
  PURCHASE_TOTAL_MISMATCH_MESSAGE,
  PurchaseInvoiceCancelSchema,
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceItemSchema,
  PurchaseInvoiceUpdateSchema,
  formatInvoiceNumber,
  isPurchaseInvoiceKind,
  isPurchaseInvoiceStatus,
  isPurchaseIvaRateId,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("type guards", () => {
  it("isPurchaseInvoiceKind", () => {
    expect(isPurchaseInvoiceKind("factura")).toBe(true);
    expect(isPurchaseInvoiceKind("nc")).toBe(true);
    expect(isPurchaseInvoiceKind("nd")).toBe(true);
    expect(isPurchaseInvoiceKind("recibo")).toBe(false);
  });

  it("isPurchaseInvoiceStatus", () => {
    expect(isPurchaseInvoiceStatus("received")).toBe(true);
    expect(isPurchaseInvoiceStatus("cancelled")).toBe(true);
    expect(isPurchaseInvoiceStatus("draft")).toBe(false);
  });

  it("isPurchaseIvaRateId", () => {
    expect(isPurchaseIvaRateId(3)).toBe(true);
    expect(isPurchaseIvaRateId(5)).toBe(true);
    expect(isPurchaseIvaRateId(9)).toBe(true);
    expect(isPurchaseIvaRateId(1)).toBe(false);
    expect(isPurchaseIvaRateId("3")).toBe(false);
  });
});

describe("formatInvoiceNumber", () => {
  it("factura usa letter como prefijo", () => {
    expect(
      formatInvoiceNumber({
        kind: "factura",
        letter: "A",
        punto_venta: 1,
        numero: 5,
      }),
    ).toBe("A00001-00000005");
  });

  it("nc → NC, nd → ND (ignora letter)", () => {
    expect(
      formatInvoiceNumber({
        kind: "nc",
        letter: "A",
        punto_venta: 7,
        numero: 100,
      }),
    ).toBe("NC00007-00000100");
    expect(
      formatInvoiceNumber({
        kind: "nd",
        letter: "B",
        punto_venta: 7,
        numero: 100,
      }),
    ).toBe("ND00007-00000100");
  });

  it("letter null usa X como fallback", () => {
    expect(
      formatInvoiceNumber({
        kind: "factura",
        letter: null,
        punto_venta: 1,
        numero: 5,
      }),
    ).toBe("X00001-00000005");
  });
});

describe("PurchaseInvoiceItemSchema", () => {
  it("acepta payload válido", () => {
    expect(
      PurchaseInvoiceItemSchema.safeParse({
        description: "Fletes",
        quantity: 1,
        unit_price: 100,
        iva_rate_id: 5,
        line_neto: 100,
        line_iva: 21,
        line_total: 121,
      }).success,
    ).toBe(true);
  });

  it("rechaza iva_rate_id fuera del set permitido", () => {
    expect(
      PurchaseInvoiceItemSchema.safeParse({
        description: "Fletes",
        quantity: 1,
        unit_price: 100,
        iva_rate_id: 99,
        line_neto: 100,
        line_iva: 21,
        line_total: 121,
      }).success,
    ).toBe(false);
  });
});

describe("PurchaseInvoiceCreateSchema", () => {
  const valid = {
    channel_id: "jouve_fiscal",
    supplier_id: UUID,
    kind: "factura" as const,
    punto_venta: 1,
    numero: 1,
    fecha: "2026-05-17",
    imp_neto: 100,
    imp_iva: 21,
    imp_total: 121,
  };

  it("acepta factura sin motivo", () => {
    expect(PurchaseInvoiceCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults exento, no gravado and the tribute split to 0", () => {
    const r = PurchaseInvoiceCreateSchema.parse(valid);
    expect(r).toMatchObject({
      imp_no_gravado: 0,
      imp_op_exentas: 0,
      imp_perc_iva: 0,
      imp_perc_iibb: 0,
      imp_perc_municipales: 0,
      imp_impuestos_internos: 0,
    });
  });

  it("refuses items without a rate next to header exento", () => {
    const item = {
      description: "Sin alícuota",
      quantity: 1,
      unit_price: 50,
      iva_rate_id: null,
      line_neto: 50,
      line_iva: 0,
      line_total: 50,
    };
    expect(
      PurchaseInvoiceCreateSchema.safeParse({
        ...valid,
        imp_op_exentas: 50,
        imp_total: 171,
        items: [item],
      }).success,
    ).toBe(false);
    expect(
      PurchaseInvoiceCreateSchema.safeParse({ ...valid, items: [item] })
        .success,
    ).toBe(true);
  });

  it("refuses a total that is not the sum of its parts", () => {
    // 290 of peajes left out of "No gravado".
    const r = PurchaseInvoiceCreateSchema.safeParse({
      ...valid,
      imp_neto: 1000,
      imp_iva: 210,
      imp_total: 1500,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      path: ["imp_total"],
      message: PURCHASE_TOTAL_MISMATCH_MESSAGE,
    });
    expect(
      PurchaseInvoiceCreateSchema.safeParse({
        ...valid,
        imp_neto: 1000,
        imp_iva: 210,
        imp_no_gravado: 290,
        imp_total: 1500.01,
      }).success,
    ).toBe(false);
    expect(
      PurchaseInvoiceCreateSchema.safeParse({
        ...valid,
        imp_neto: 1000,
        imp_iva: 210,
        imp_no_gravado: 290,
        imp_total: 1500,
      }).success,
    ).toBe(true);
  });

  it("rechaza NC sin motivo", () => {
    expect(
      PurchaseInvoiceCreateSchema.safeParse({ ...valid, kind: "nc" }).success,
    ).toBe(false);
  });

  it("acepta NC con motivo y comprobante de origen", () => {
    expect(
      PurchaseInvoiceCreateSchema.safeParse({
        ...valid,
        kind: "nc",
        motivo_nc_nd: "Devolución",
        invoice_origin_id: UUID,
      }).success,
    ).toBe(true);
  });

  it("rechaza NC/ND sin comprobante de origen", () => {
    const r = PurchaseInvoiceCreateSchema.safeParse({
      ...valid,
      kind: "nd",
      motivo_nc_nd: "Intereses",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["invoice_origin_id"]);
  });
});

describe("PurchaseInvoiceCancelSchema", () => {
  it("acepta id UUID", () => {
    expect(PurchaseInvoiceCancelSchema.safeParse({ id: UUID }).success).toBe(
      true,
    );
  });
});

describe("PurchaseInvoiceCreateSchema — foreign currency", () => {
  const base = {
    channel_id: "ch1",
    supplier_id: "11111111-1111-4111-8111-111111111111",
    kind: "factura",
    punto_venta: 1,
    numero: 1,
    fecha: "2026-10-16",
    imp_neto: 100,
    imp_iva: 21,
    imp_total: 121,
  };

  it("requires a rate above 1 for a dollar invoice", () => {
    const res = PurchaseInvoiceCreateSchema.safeParse({
      ...base,
      moneda: "DOL",
      cotizacion: 1,
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(
      "Cargá la cotización del dólar (tiene que ser mayor a 1).",
    );
    expect(
      PurchaseInvoiceCreateSchema.safeParse({
        ...base,
        moneda: "DOL",
        cotizacion: 1200,
      }).success,
    ).toBe(true);
  });

  it("keeps pesos at rate 1", () => {
    expect(PurchaseInvoiceCreateSchema.safeParse(base).success).toBe(true);
  });
});

describe("PurchaseInvoiceUpdateSchema", () => {
  it("leaves the breakdown out when the edit does not send it", () => {
    const r = PurchaseInvoiceUpdateSchema.parse({ id: UUID, notes: "x" });
    expect(r.imp_perc_iibb).toBeUndefined();
    expect(r.imp_op_exentas).toBeUndefined();
  });

  it("leaves the amounts and the currency out when the edit does not send them", () => {
    const r = PurchaseInvoiceUpdateSchema.parse({ id: UUID, notes: "x" });
    expect(r).toEqual({ id: UUID, notes: "x" });
  });
});

describe("PurchaseInvoiceUpdateSchema leaves out what an edit does not send", () => {
  it("does not fill amounts, currency or items with their create defaults", () => {
    const parsed = PurchaseInvoiceUpdateSchema.parse({ id: UUID, notes: "x" });
    for (const key of [
      "imp_neto",
      "imp_iva",
      "imp_trib",
      "imp_total",
      "moneda",
      "cotizacion",
      "items",
    ] as const) {
      expect(parsed[key], key).toBeUndefined();
    }
  });

  it("still reads the ones it sends", () => {
    const parsed = PurchaseInvoiceUpdateSchema.parse({
      id: UUID,
      imp_neto: "100",
      moneda: "DOL",
      cotizacion: 1000,
      items: [],
    });
    expect(parsed).toMatchObject({
      imp_neto: 100,
      moneda: "DOL",
      cotizacion: 1000,
      items: [],
    });
  });
});
