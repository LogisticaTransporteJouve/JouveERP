import { describe, expect, it } from "vitest";

import {
  applyInvoicePostInference,
  completeAmounts,
  computeItemTotals,
  dueDateFromTerms,
  inferUniformAlicuota,
  normalizeAlicuota,
} from "./post-inference";
import {
  EXTRACTION_SCHEMAS,
  InvoiceExtractionSchema,
  isExtractableKind,
} from "./schemas";

describe("inferUniformAlicuota", () => {
  it("returns the shared rate, null when mixed or empty", () => {
    expect(inferUniformAlicuota([21, 21, null])).toBe(21);
    expect(inferUniformAlicuota([21, 10.5])).toBeNull();
    expect(inferUniformAlicuota([null, null])).toBeNull();
  });
});

describe("applyInvoicePostInference — rate fill-in", () => {
  it("propagates a uniform line rate to a line missing it", () => {
    const inv = InvoiceExtractionSchema.parse({
      items: [
        { description: "A", net_amount: 100, iva_rate: 21 },
        { description: "B", net_amount: 200 },
      ],
    });
    const out = applyInvoicePostInference(inv);
    expect(out.items[1]?.iva_rate).toBe(21);
    expect(out.items[1]?.iva_amount).toBe(42);
  });

  it("zero-rates lines when the header shows no IVA", () => {
    const inv = InvoiceExtractionSchema.parse({
      net_amount: 300,
      iva_amount: 0,
      total_amount: 300,
      items: [{ description: "Exento", net_amount: 300 }],
    });
    const out = applyInvoicePostInference(inv);
    expect(out.items[0]?.iva_rate).toBe(0);
    expect(out.items[0]?.iva_amount).toBe(0);
  });
});

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
        quantity: 2,
        unit_price: 100,
        alicuota: 21,
      }),
    ).toEqual({ net_amount: 200, iva_amount: 42, total_amount: 242 });
  });

  it("applies a line discount", () => {
    expect(
      computeItemTotals({
        quantity: 1,
        unit_price: 100,
        discount_pct: 10,
        alicuota: 21,
      }),
    ).toEqual({ net_amount: 90, iva_amount: 18.9, total_amount: 108.9 });
  });

  it("never overwrites values the document provided", () => {
    expect(
      computeItemTotals({
        quantity: 2,
        unit_price: 100,
        alicuota: 21,
        net_amount: 999,
      }),
    ).toEqual({ net_amount: 999, iva_amount: 209.79, total_amount: 1208.79 });
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
      date: "2026-03-12",
      payment_terms: "30 días",
      net_amount: 1000,
      iva_amount: 210,
      items: [
        {
          description: "Servicio",
          quantity: 2,
          unit_price: 500,
          iva_rate: "21%",
        },
      ],
    });
    const out = applyInvoicePostInference(inv);
    expect(out.total_amount).toBe(1210); // header triangle
    expect(out.due_date).toBe("2026-04-11"); // due date from terms
    expect(out.items[0]).toMatchObject({
      iva_rate: 21,
      net_amount: 1000,
      iva_amount: 210,
      total_amount: 1210,
    });
  });

  it("keeps a provided due date and does not invent missing amounts", () => {
    const inv = InvoiceExtractionSchema.parse({
      due_date: "2026-05-01",
      net_amount: 500,
      items: [],
    });
    const out = applyInvoicePostInference(inv);
    expect(out.due_date).toBe("2026-05-01");
    expect(out.total_amount).toBeNull();
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
      counterparty_name: "Acme SA",
      number: 12345,
      items: [{ description: "Servicio", iva_rate: "21%" }],
    });
    expect(parsed.success).toBe(true);
  });
});
