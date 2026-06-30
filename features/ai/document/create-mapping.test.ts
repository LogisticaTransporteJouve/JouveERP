import { describe, expect, it } from "vitest";

import { PurchaseInvoiceCreateSchema } from "@/features/purchase-invoices/schema";

import { buildPurchaseInvoiceInput } from "./create-mapping";

const OPTS = {
  channelId: "chan-1",
  supplierId: "11111111-1111-4111-8111-111111111111",
};

describe("buildPurchaseInvoiceInput", () => {
  it("threads account_id / cost_center_id from opts (null by default)", () => {
    const payload = { numero: 1, fecha: "2026-03-12", importe_total: 100 };
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
      contraparte_cuit: "30-12345678-9",
      punto_venta: 1,
      numero: 12345,
      letra: "A",
      fecha: "2026-03-12",
      moneda: "ARS",
      importe_neto: 1000,
      importe_iva: 210,
      importe_total: 1210,
      items: [
        {
          descripcion: "Servicio",
          cantidad: 2,
          precio_unitario: 500,
          alicuota_iva: 21,
          importe_neto: 1000,
          importe_iva: 210,
          importe_total: 1210,
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
        punto_venta: 2,
        numero: 7,
        fecha: "2026-02-01",
        moneda: "USD",
        importe_total: 110.5,
        items: [
          {
            descripcion: "X",
            cantidad: 1,
            precio_unitario: 100,
            alicuota_iva: 10.5,
            importe_neto: 100,
            importe_iva: 10.5,
            importe_total: 110.5,
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
        punto_venta: 1,
        numero: 1,
        fecha: "2026-01-01",
        importe_total: 500,
        // line has neither neto nor unit price → unit_price null → invalid
        items: [{ descripcion: "Sin precio", alicuota_iva: 21 }],
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
