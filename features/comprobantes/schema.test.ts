import { describe, expect, it } from "vitest";

import { CONCEPTO, DOC_TIPO, IVA_RATE } from "@/lib/afip/codes";

import {
  CreateComprobanteSchema,
  computeTotals,
  isComprobanteKind,
  isComprobanteLetter,
  isComprobanteStatus,
} from "./schema";

describe("type guards", () => {
  it("validates kind", () => {
    expect(isComprobanteKind("factura")).toBe(true);
    expect(isComprobanteKind("nc")).toBe(true);
    expect(isComprobanteKind("nd")).toBe(true);
    expect(isComprobanteKind("ghost")).toBe(false);
  });

  it("validates letter", () => {
    expect(isComprobanteLetter("A")).toBe(true);
    expect(isComprobanteLetter("D")).toBe(false);
    expect(isComprobanteLetter(null)).toBe(false);
  });

  it("validates status", () => {
    expect(isComprobanteStatus("draft")).toBe(true);
    expect(isComprobanteStatus("emitting")).toBe(true);
    expect(isComprobanteStatus("paid")).toBe(false);
  });
});

describe("CreateComprobanteSchema", () => {
  const baseInput = {
    channel_id: "jouve_fiscal",
    client_id: "12345678-1234-4234-8234-123456789012",
    kind: "factura" as const,
    letter: "B" as const,
    punto_venta: 3,
    fecha: "2026-05-09",
    concepto: CONCEPTO.SERVICIOS,
    doc_tipo: DOC_TIPO.CUIT,
    doc_nro: "30714637432",
    iva_condition_receptor: 1 as const,
    items: [
      { description: "Flete", quantity: 1, unit_price: 100, iva_rate_id: IVA_RATE.TWENTY_ONE },
    ],
  };

  it("accepts a valid factura input", () => {
    const result = CreateComprobanteSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it("rejects NC without comprobante origen", () => {
    const result = CreateComprobanteSchema.safeParse({
      ...baseInput,
      kind: "nc",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["comprobante_origen_id"]);
    }
  });

  it("accepts NC with comprobante origen", () => {
    const result = CreateComprobanteSchema.safeParse({
      ...baseInput,
      kind: "nc",
      comprobante_origen_id: "12345678-1234-4234-8234-123456789012",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty items", () => {
    const result = CreateComprobanteSchema.safeParse({
      ...baseInput,
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects bad fecha format", () => {
    const result = CreateComprobanteSchema.safeParse({
      ...baseInput,
      fecha: "09/05/2026",
    });
    expect(result.success).toBe(false);
  });
});

describe("computeTotals", () => {
  it("sums neto without IVA when not fiscal", () => {
    const totals = computeTotals(
      [
        { quantity: 2, unit_price: 50, iva_rate_id: IVA_RATE.TWENTY_ONE },
        { quantity: 1, unit_price: 30, iva_rate_id: null },
      ],
      false,
    );
    expect(totals.imp_neto).toBe(130);
    expect(totals.imp_iva).toBe(0);
    expect(totals.imp_total).toBe(130);
    expect(totals.per_rate).toEqual([]);
  });

  it("sums IVA per rate for fiscal", () => {
    const totals = computeTotals(
      [
        { quantity: 1, unit_price: 100, iva_rate_id: IVA_RATE.TWENTY_ONE },
        { quantity: 1, unit_price: 200, iva_rate_id: IVA_RATE.TEN_FIVE },
      ],
      true,
    );
    expect(totals.imp_neto).toBe(300);
    expect(totals.imp_iva).toBe(42); // 21 + 21
    expect(totals.imp_total).toBe(342);
    const map = Object.fromEntries(
      totals.per_rate.map((p) => [p.id, p.importe]),
    );
    expect(map[IVA_RATE.TWENTY_ONE]).toBe(21);
    expect(map[IVA_RATE.TEN_FIVE]).toBe(21);
  });

  it("rounds each line first to avoid AFIP reconciliation errors", () => {
    // 0.333 * 3 = 0.999 — naive sum would round to 1.00, AFIP expects per-line
    // rounded values to add up exactly.
    const totals = computeTotals(
      [
        { quantity: 3, unit_price: 0.333, iva_rate_id: IVA_RATE.TWENTY_ONE },
      ],
      true,
    );
    expect(totals.imp_neto).toBe(1.0); // 0.333 * 3 → 0.999 → round → 1.00
    // Line IVA: 1.00 * 21% = 0.21
    expect(totals.imp_iva).toBe(0.21);
    expect(totals.imp_total).toBe(1.21);
  });

  it("groups multiple lines at the same rate into one bucket", () => {
    const totals = computeTotals(
      [
        { quantity: 1, unit_price: 100, iva_rate_id: IVA_RATE.TWENTY_ONE },
        { quantity: 1, unit_price: 50, iva_rate_id: IVA_RATE.TWENTY_ONE },
      ],
      true,
    );
    expect(totals.per_rate).toHaveLength(1);
    expect(totals.per_rate[0]).toEqual({
      id: IVA_RATE.TWENTY_ONE,
      base: 150,
      importe: 31.5,
    });
  });
});
