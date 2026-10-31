import { describe, expect, it } from "vitest";

import { aggregateClientAging, type ClientAgingViewRow } from "@/lib/aging";

import {
  accountStatementTable,
  agingExport,
  cellText,
  cellValue,
  dateCell,
  ExportInputError,
  exportScope,
  exportSheet,
  moneyCell,
  totalCell,
  withSlug,
} from "./shared";

describe("exportScope", () => {
  const scopeOf = (query: string) => exportScope(new URLSearchParams(query));

  it("defaults to every channel", () => {
    expect(scopeOf("")).toEqual({ scope: "all", isFiscal: null });
  });

  it("maps fiscal and internal to isFiscal", () => {
    expect(scopeOf("scope=fiscal")).toEqual({
      scope: "fiscal",
      isFiscal: true,
    });
    expect(scopeOf("scope=internal")).toEqual({
      scope: "internal",
      isFiscal: false,
    });
  });

  it("rejects anything else as bad input", () => {
    expect(() => scopeOf("scope=dz")).toThrow(ExportInputError);
    expect(() => scopeOf("scope=")).toThrow(ExportInputError);
  });
});

describe("export cells", () => {
  it("print their text in the PDF", () => {
    expect(cellText(moneyCell(-10))).toBe("$-10,00");
    expect(cellText(moneyCell(5, { currency: "USD", text: "US$5,00" }))).toBe(
      "US$5,00",
    );
    expect(cellText(dateCell("2026-06-05"))).toBe("5 jun 2026");
    expect(dateCell(null)).toBe("—");
  });
});

describe("exportSheet", () => {
  it("types right-aligned columns as numbers and keeps the rest as text", () => {
    const sheet = exportSheet(
      {
        title: "Vehículos",
        subtitle: "Flota propia",
        columns: [
          { header: "Patente", width: 90 },
          { header: "Año", width: 50, align: "right" },
          { header: "Total", width: 90, align: "right" },
        ],
        rows: [["AB123CD", "2020", moneyCell(10)]],
        totalsRow: ["Total", "", moneyCell(10)],
        fileName: "vehiculos",
      },
      { dateRangeLabel: "Todo el historial", generatedAt: "5 jun 2026 10:00" },
    );
    expect(sheet.preamble).toEqual([
      "Vehículos",
      "Flota propia",
      "Período: Todo el historial",
      "Generado el 5 jun 2026 10:00",
    ]);
    expect(sheet.columns).toEqual([
      { header: "Patente", type: "text" },
      { header: "Año", type: "number" },
      { header: "Total", type: "number" },
    ]);
    expect(sheet.rows).toEqual([
      ["AB123CD", "2020", { money: 10, currency: "ARS" }],
    ]);
    expect(sheet.totals).toEqual(["Total", "", { money: 10, currency: "ARS" }]);
  });
});

describe("withSlug", () => {
  it("appends a slug of the entity when there is one", () => {
    expect(
      withSlug("cuenta-corriente-cliente", "Acmé S.A. · CUIT 30-71234567-8"),
    ).toBe("cuenta-corriente-cliente-acme-s-a-cuit-30-71234567-8");
    expect(withSlug("cuenta-corriente-cliente", null)).toBe(
      "cuenta-corriente-cliente",
    );
    expect(withSlug("x", "¿?")).toBe("x");
  });
});

describe("totalCell", () => {
  it("is an amount in the rows' one currency, and only text when they mix", () => {
    expect(totalCell(10, new Set(["USD"]))).toEqual({
      text: "$10,00",
      value: { money: 10, currency: "USD" },
    });
    expect(totalCell(10, new Set())).toMatchObject({
      value: { money: 10, currency: "ARS" },
    });
    expect(totalCell(10, new Set(["ARS", "USD"]))).toBe("$10,00");
  });
});

describe("agingExport", () => {
  const zero = {
    ars_bucket_0_30: 0,
    ars_bucket_30_60: 0,
    ars_bucket_60_90: 0,
    ars_bucket_90_plus: 0,
    ars_total_open: 0,
    usd_bucket_0_30: 0,
    usd_bucket_30_60: 0,
    usd_bucket_60_90: 0,
    usd_bucket_90_plus: 0,
    usd_total_open: 0,
    document_count: 1,
    oldest_days: 10,
  };
  const party = (
    id: string,
    over: Partial<ClientAgingViewRow>,
  ): ClientAgingViewRow => ({
    ...zero,
    client_id: id,
    clients: { legal_name: id, display_name: null, cuit: "20-1-2" },
    ...over,
  });
  const meta = {
    title: "Aging",
    subtitle: "Saldos",
    partyHeader: "Cliente",
    fileName: "aging",
  };

  it("writes one row per currency, each amount typed in its own currency", () => {
    const out = agingExport(
      aggregateClientAging(
        [
          party("mixto", {
            ars_bucket_0_30: 100,
            ars_total_open: 100,
            usd_bucket_90_plus: 2,
            usd_total_open: 2,
          }),
        ],
        { rate: 1000, rate_date: "2026-10-15" },
      ),
      meta,
    );
    const headers = out.columns.map((c) => c.header);
    const at = (r: number, h: string) => out.rows[r]?.[headers.indexOf(h)];
    expect(at(0, "Moneda")).toBe("ARS");
    expect(cellValue(at(0, "0–30 días") ?? "")).toEqual({
      money: 100,
      currency: "ARS",
    });
    expect(cellValue(at(0, "Total en ARS") ?? "")).toEqual({
      money: 2100,
      currency: "ARS",
    });
    expect(at(1, "Moneda")).toBe("USD");
    expect(cellValue(at(1, "90+") ?? "")).toEqual({
      money: 2,
      currency: "USD",
    });
    expect(cellText(at(1, "Total") ?? "")).toBe("US$2,00");
    // Per-currency totals as rows, the peso equivalent in the totals row.
    expect(out.rows.map((r) => r[0])).toEqual([
      "mixto",
      "mixto",
      "Totales en pesos",
      "Totales en dólares",
    ]);
    expect(cellValue(out.totalsRow?.at(-1) ?? "")).toEqual({
      money: 2100,
      currency: "ARS",
    });
    expect(out.subtitle).toContain("dólar oficial");
    expect(out.columns.reduce((s, c) => s + c.width, 0)).toBe(794);
  });

  it("keeps a peso-only report to a single totals row, and says when there is no rate", () => {
    const pesos = agingExport(
      aggregateClientAging([party("a", { ars_total_open: 5 })], null),
      meta,
    );
    expect(pesos.rows).toHaveLength(1);
    expect(pesos.totalsRow?.[0]).toBe("Totales");
    expect(pesos.subtitle).toContain("Sin cotización");
    const noRate = agingExport(
      aggregateClientAging([party("u", { usd_total_open: 3 })], null),
      meta,
    );
    expect(noRate.totalsRow?.at(-1)).toBe("—");
  });
});

describe("accountStatementTable", () => {
  const line = (
    currency: "ARS" | "USD",
    debe: number,
    haber: number,
    balance: number | null,
  ) => ({
    date: "2026-10-01",
    type: "Factura A",
    document: "A 0003-00000001",
    currency,
    debe,
    haber,
    balance,
  });

  it("with one currency, the totals row is that currency's", () => {
    const t = accountStatementTable(
      [line("ARS", 1000, 0, 1000), line("ARS", 0, 400, 600)],
      { ARS: 600, USD: 0 },
    );
    expect(t.totalsRow?.map(cellText)).toEqual([
      "",
      "",
      "Totales",
      "ARS",
      "$1.000,00",
      "$400,00",
      "$600,00",
    ]);
  });

  it("never sums pesos and dollars: one totals row per currency", () => {
    const t = accountStatementTable(
      [line("ARS", 1000, 0, 1000), line("USD", 50, 0, 50)],
      { ARS: 1000, USD: 50 },
    );
    expect(t.totalsRow).toBeUndefined();
    expect(t.rows.at(-2)?.map(cellText)).toEqual([
      "",
      "",
      "Totales en pesos",
      "ARS",
      "$1.000,00",
      "$0,00",
      "$1.000,00",
    ]);
    expect(t.rows.at(-1)?.map(cellText)).toEqual([
      "",
      "",
      "Totales en dólares",
      "USD",
      "US$50,00",
      "US$0,00",
      "US$50,00",
    ]);
    expect(cellValue(t.rows[1]![4]!)).toEqual({ money: 50, currency: "USD" });
  });

  it("under a scope (no running balance) the final balance is the action's", () => {
    const t = accountStatementTable([line("ARS", 1000, 0, null)], {
      ARS: 250,
      USD: 0,
    });
    expect(t.totalsRow?.at(-1) && cellText(t.totalsRow.at(-1)!)).toBe(
      "$250,00",
    );
  });
});
