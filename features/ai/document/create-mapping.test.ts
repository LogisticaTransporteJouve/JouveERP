import { describe, expect, it } from "vitest";

import { PurchaseInvoiceCreateSchema } from "@/features/purchase-invoices/schema";

import { buildPurchaseInvoiceInput } from "./create-mapping";

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
});
