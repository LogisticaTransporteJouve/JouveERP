import { describe, expect, it } from "vitest";

import {
  invoiceListFilters,
  invoiceListParamsToUrl,
  invoiceTypesOrFilter,
  parseInvoiceListParams,
  parseSearchTerm,
} from "./invoice-list-filters";

const CLIENT = "6f1c2b9a-1d2e-4c3f-9a8b-7c6d5e4f3a2b";

describe("parseInvoiceListParams", () => {
  it("reads every filter from the URL", () => {
    expect(
      parseInvoiceListParams({
        status: "emitted",
        q: "acme",
        type: "nc,factura_A,bogus,nc",
        pv: "3",
        client: CLIENT,
        period: "this_month",
        group: "day",
      }),
    ).toEqual({
      status: "emitted",
      query: "acme",
      types: ["factura_A", "nc"],
      puntoVenta: 3,
      clientId: CLIENT,
      period: { preset: "this_month", from: null, to: null },
      group: "day",
    });
  });

  it("drops invalid values", () => {
    const parsed = parseInvoiceListParams({
      status: "x",
      type: "remito",
      pv: "0",
      client: "not-a-uuid",
      group: "none",
    });
    expect(parsed).toMatchObject({
      status: null,
      types: [],
      puntoVenta: null,
      clientId: null,
      group: null,
    });
    expect(parseInvoiceListParams({ pv: "123456" }).puntoVenta).toBe(null);
  });

  it("round-trips through the URL", () => {
    const params = parseInvoiceListParams({
      type: "factura_B,nd",
      pv: "11",
      period: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
      group: "week",
    });
    const url = invoiceListParamsToUrl(params);
    const back = parseInvoiceListParams(
      Object.fromEntries(
        Object.entries(url).filter(([, v]) => v !== null) as [string, string][],
      ),
    );
    expect(back).toEqual(params);
  });
});

describe("invoiceListFilters", () => {
  it("resolves the period against today", () => {
    const filters = invoiceListFilters(
      parseInvoiceListParams({ period: "yesterday", q: "  42 " }),
      true,
      "2026-10-31",
    );
    expect(filters).toMatchObject({
      isFiscal: true,
      query: "42",
      from: "2026-10-30",
      to: "2026-10-30",
    });
  });
});

describe("invoiceTypesOrFilter", () => {
  it("matches facturas by letter and NC/ND whole", () => {
    expect(invoiceTypesOrFilter(["nc", "factura_A"])).toBe(
      "and(kind.eq.factura,letter.eq.A),kind.eq.nc",
    );
  });

  it("drops unknown values instead of interpolating them", () => {
    expect(invoiceTypesOrFilter(["kind.eq.factura),id.neq.0"])).toBe(null);
    expect(invoiceTypesOrFilter([])).toBe(null);
  });
});

describe("parseSearchTerm", () => {
  it("splits numbers from names", () => {
    expect(parseSearchTerm("  123 ")).toEqual({
      numero: 123,
      clientName: null,
    });
    expect(parseSearchTerm("Acme 2")).toEqual({
      numero: null,
      clientName: "Acme 2",
    });
    expect(parseSearchTerm("")).toEqual({ numero: null, clientName: null });
  });
});
