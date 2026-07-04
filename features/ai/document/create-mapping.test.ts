import { describe, expect, it } from "vitest";

import { PurchaseInvoiceCreateSchema } from "@/features/purchase-invoices/schema";

import {
  buildPurchaseInvoiceInput,
  buildSalesInvoiceItems,
} from "./create-mapping";

const OPTS = {
  channelId: "chan-1",
  supplierId: "11111111-1111-4111-8111-111111111111",
};

describe("buildPurchaseInvoiceInput", () => {
  it("threads account_id / cost_center_id from opts (null by default)", () => {
    const payload = { number: 1, date: "2026-03-12", total_amount: 100 };
    const base = buildPurchaseInvoiceInput(payload, OPTS);
    expect(base?.account_id).toBeNull();
    expect(base?.cost_center_id).toBeNull();
    const withIds = buildPurchaseInvoiceInput(payload, {
      ...OPTS,
      accountId: "22222222-2222-4222-8222-222222222222",
      costCenterId: "33333333-3333-4333-8333-333333333333",
    });
    expect(withIds?.account_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(withIds?.cost_center_id).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("maps a complete invoice with items that pass the create schema", () => {
    const payload = {
      counterparty_cuit: "30-12345678-9",
      sales_point: 1,
      number: 12345,
      letter: "A",
      date: "2026-03-12",
      currency: "ARS",
      net_amount: 1000,
      iva_amount: 210,
      total_amount: 1210,
      items: [
        {
          description: "Servicio",
          quantity: 2,
          unit_price: 500,
          iva_rate: 21,
          net_amount: 1000,
          iva_amount: 210,
          total_amount: 1210,
        },
      ],
    };
    const input = buildPurchaseInvoiceInput(payload, OPTS);
    expect(input).not.toBeNull();
    expect(input?.kind).toBe("factura");
    expect(input?.moneda).toBe("PES");
    expect(input?.items).toHaveLength(1);
    // The whole thing must be accepted by the real create schema.
    expect(PurchaseInvoiceCreateSchema.safeParse(input).success).toBe(true);
  });

  it("maps USD → DOL and a single 10.5% line to rate id 4", () => {
    const input = buildPurchaseInvoiceInput(
      {
        sales_point: 2,
        number: 7,
        date: "2026-02-01",
        currency: "USD",
        total_amount: 110.5,
        items: [
          {
            description: "X",
            quantity: 1,
            unit_price: 100,
            iva_rate: 10.5,
            net_amount: 100,
            iva_amount: 10.5,
            total_amount: 110.5,
          },
        ],
      },
      OPTS,
    );
    expect(input?.moneda).toBe("DOL");
    const item = input?.items[0] as { iva_rate_id: number } | undefined;
    expect(item?.iva_rate_id).toBe(4);
  });

  it("falls back to header-only when a line can't be mapped", () => {
    const input = buildPurchaseInvoiceInput(
      {
        sales_point: 1,
        number: 1,
        date: "2026-01-01",
        total_amount: 500,
        // line has neither neto nor unit price → unit_price null → invalid
        items: [{ description: "Sin precio", iva_rate: 21 }],
      },
      OPTS,
    );
    expect(input?.items).toHaveLength(0);
    expect(PurchaseInvoiceCreateSchema.safeParse(input).success).toBe(true);
  });

  it("returns null for a non-invoice payload", () => {
    expect(buildPurchaseInvoiceInput("nope", OPTS)).toBeNull();
  });

  it("maps a scanned NC with kind + motivo that pass the create schema", () => {
    const input = buildPurchaseInvoiceInput(
      { sales_point: 1, number: 9, date: "2026-05-01", total_amount: 121 },
      { ...OPTS, kind: "nc", motivo: "Devolución de mercadería" },
    );
    expect(input?.kind).toBe("nc");
    expect(input?.motivo_nc_nd).toBe("Devolución de mercadería");
    expect(PurchaseInvoiceCreateSchema.safeParse(input).success).toBe(true);
  });

  it("defaults kind to factura with null motivo", () => {
    const input = buildPurchaseInvoiceInput(
      { number: 1, date: "2026-03-12", total_amount: 100 },
      OPTS,
    );
    expect(input?.kind).toBe("factura");
    expect(input?.motivo_nc_nd).toBeNull();
  });
});

describe("buildSalesInvoiceItems", () => {
  it("maps extracted lines and infers the rate id from amounts", () => {
    const built = buildSalesInvoiceItems({
      date: "2026-06-01",
      items: [
        {
          description: "Flete Rosario",
          quantity: 2,
          unit_price: 500,
          net_amount: 1000,
          iva_amount: 210,
        },
      ],
    });
    expect(built?.fallback).toBe(false);
    expect(built?.items).toHaveLength(1);
    expect(built?.items[0]?.iva_rate_id).toBe(5);
  });

  it("prefers the printed alícuota over inference", () => {
    const built = buildSalesInvoiceItems({
      items: [
        {
          description: "X",
          quantity: 1,
          unit_price: 100,
          iva_rate: 10.5,
          net_amount: 100,
          iva_amount: 10.5,
        },
      ],
    });
    expect(built?.items[0]?.iva_rate_id).toBe(4);
  });

  it("falls back to a single header-derived line when items don't map", () => {
    const built = buildSalesInvoiceItems({
      net_amount: 1000,
      iva_amount: 210,
      total_amount: 1210,
      items: [{ description: "Sin precio" }],
    });
    expect(built?.fallback).toBe(true);
    expect(built?.items).toHaveLength(1);
    expect(built?.items[0]?.unit_price).toBe(1000);
    expect(built?.items[0]?.iva_rate_id).toBe(5);
  });

  it("derives the neto from total - iva when the header has no neto", () => {
    const built = buildSalesInvoiceItems({
      iva_amount: 21,
      total_amount: 121,
      items: [],
    });
    expect(built?.fallback).toBe(true);
    expect(built?.items[0]?.unit_price).toBe(100);
    expect(built?.items[0]?.iva_rate_id).toBe(5);
  });

  it("returns null when not even the header has an amount", () => {
    expect(buildSalesInvoiceItems({ items: [] })).toBeNull();
    expect(buildSalesInvoiceItems("nope")).toBeNull();
  });
});
