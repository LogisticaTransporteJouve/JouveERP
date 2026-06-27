import { describe, expect, it } from "vitest";

import {
  applyInvoicePostInference,
  completeAmounts,
  computeItemTotals,
  dueDateFromTerms,
  normalizeAlicuota,
} from "./post-inference";
import {
  EXTRACTION_SCHEMAS,
  InvoiceExtractionSchema,
  isExtractableKind,
} from "./schemas";

describe("completeAmounts (amount triangle)", () => {
  it("derives total from neto + iva", () => {
    expect(completeAmounts({ neto: 1000, iva: 210, total: null })).toEqual({
      neto: 1000,
      iva: 210,
      total: 1210,
    });
  });

  it("derives iva from total − neto", () => {
    expect(completeAmounts({ neto: 1000, iva: null, total: 1210 })).toEqual({
      neto: 1000,
      iva: 210,
      total: 1210,
    });
  });

  it("derives neto from total − iva", () => {
    expect(completeAmounts({ neto: null, iva: 210, total: 1210 })).toEqual({
      neto: 1000,
      iva: 210,
      total: 1210,
    });
  });

  it("accounts for other taxes (trib)", () => {
    expect(
      completeAmounts({ neto: 1000, iva: 210, total: null, trib: 30 }),
    ).toEqual({ neto: 1000, iva: 210, total: 1240 });
  });

  it("leaves fields null when fewer than two are known", () => {
    expect(completeAmounts({ neto: 1000, iva: null, total: null })).toEqual({
      neto: 1000,
      iva: null,
      total: null,
    });
  });
});

describe("normalizeAlicuota", () => {
  it("passes through valid rates", () => {
    expect(normalizeAlicuota(21)).toBe(21);
    expect(normalizeAlicuota(10.5)).toBe(10.5);
    expect(normalizeAlicuota(0)).toBe(0);
  });

  it("scales decimal fractions", () => {
    expect(normalizeAlicuota(0.21)).toBe(21);
    expect(normalizeAlicuota(0.105)).toBe(10.5);
  });

  it("parses strings and exempt", () => {
    expect(normalizeAlicuota("21%")).toBe(21);
    expect(normalizeAlicuota("10,5")).toBe(10.5);
    expect(normalizeAlicuota("exento")).toBe(0);
    expect(normalizeAlicuota("no gravado")).toBe(0);
  });

  it("snaps tiny float error but rejects far-off values", () => {
    expect(normalizeAlicuota(20.99)).toBe(21);
    expect(normalizeAlicuota(13)).toBeNull();
    expect(normalizeAlicuota("abc")).toBeNull();
    expect(normalizeAlicuota(null)).toBeNull();
  });
});

describe("computeItemTotals", () => {
  it("computes neto, iva, total from qty × price and rate", () => {
    expect(
      computeItemTotals({
        cantidad: 2,
        precio_unitario: 100,
        alicuota: 21,
      }),
    ).toEqual({ importe_neto: 200, importe_iva: 42, importe_total: 242 });
  });

  it("applies a line discount", () => {
    expect(
      computeItemTotals({
        cantidad: 1,
        precio_unitario: 100,
        bonif_pct: 10,
        alicuota: 21,
      }),
    ).toEqual({ importe_neto: 90, importe_iva: 18.9, importe_total: 108.9 });
  });

  it("never overwrites values the document provided", () => {
    expect(
      computeItemTotals({
        cantidad: 2,
        precio_unitario: 100,
        alicuota: 21,
        importe_neto: 999,
      }),
    ).toEqual({ importe_neto: 999, importe_iva: 209.79, importe_total: 1208.79 });
  });
});

describe("dueDateFromTerms", () => {
  it("adds N days for 'N días'", () => {
    expect(dueDateFromTerms("2026-03-12", "30 días")).toBe("2026-04-11");
    expect(dueDateFromTerms("2026-01-31", "30 dias fecha factura")).toBe(
      "2026-03-02",
    );
  });

  it("returns the same date for contado", () => {
    expect(dueDateFromTerms("2026-03-12", "contado")).toBe("2026-03-12");
  });

  it("returns null for unparseable input", () => {
    expect(dueDateFromTerms("2026-03-12", "a convenir")).toBeNull();
    expect(dueDateFromTerms(null, "30 días")).toBeNull();
  });
});

describe("applyInvoicePostInference", () => {
  it("normalizes rates, completes line + header amounts, and derives due date", () => {
    const inv = InvoiceExtractionSchema.parse({
      fecha: "2026-03-12",
      condicion_pago: "30 días",
      importe_neto: 1000,
      importe_iva: 210,
      items: [
        {
          descripcion: "Servicio",
          cantidad: 2,
          precio_unitario: 500,
          alicuota_iva: "21%",
        },
      ],
    });
    const out = applyInvoicePostInference(inv);
    expect(out.importe_total).toBe(1210); // header triangle
    expect(out.fch_vto_pago).toBe("2026-04-11"); // due date from terms
    expect(out.items[0]).toMatchObject({
      alicuota_iva: 21,
      importe_neto: 1000,
      importe_iva: 210,
      importe_total: 1210,
    });
  });

  it("keeps a provided due date and does not invent missing amounts", () => {
    const inv = InvoiceExtractionSchema.parse({
      fch_vto_pago: "2026-05-01",
      importe_neto: 500,
      items: [],
    });
    const out = applyInvoicePostInference(inv);
    expect(out.fch_vto_pago).toBe("2026-05-01");
    expect(out.importe_total).toBeNull();
  });
});

describe("extraction schemas", () => {
  it("maps extractable kinds and validates a lenient invoice payload", () => {
    expect(isExtractableKind("factura_compra")).toBe(true);
    expect(isExtractableKind("remito")).toBe(true);
    expect(isExtractableKind("cheque")).toBe(true);
    expect(isExtractableKind("extracto")).toBe(true);
    expect(isExtractableKind("otro")).toBe(false);
    const parsed = EXTRACTION_SCHEMAS.factura_compra.safeParse({
      contraparte_nombre: "Acme SA",
      numero: 12345,
      items: [{ descripcion: "Servicio", alicuota_iva: "21%" }],
    });
    expect(parsed.success).toBe(true);
  });
});
