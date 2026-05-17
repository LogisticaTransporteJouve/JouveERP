import { describe, expect, it } from "vitest";

import {
  PurchaseInvoiceCancelSchema,
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceItemSchema,
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
    imp_total: 121,
  };

  it("acepta factura sin motivo", () => {
    expect(PurchaseInvoiceCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza NC sin motivo", () => {
    expect(
      PurchaseInvoiceCreateSchema.safeParse({ ...valid, kind: "nc" }).success,
    ).toBe(false);
  });

  it("acepta NC con motivo", () => {
    expect(
      PurchaseInvoiceCreateSchema.safeParse({
        ...valid,
        kind: "nc",
        motivo_nc_nd: "Devolución",
      }).success,
    ).toBe(true);
  });
});

describe("PurchaseInvoiceCancelSchema", () => {
  it("acepta id UUID", () => {
    expect(PurchaseInvoiceCancelSchema.safeParse({ id: UUID }).success).toBe(
      true,
    );
  });
});
