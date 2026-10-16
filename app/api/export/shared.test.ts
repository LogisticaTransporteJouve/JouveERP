import { describe, expect, it } from "vitest";

import { aggregateClientAging, type ClientAgingViewRow } from "@/lib/aging";

import {
  agingExport,
  cellText,
  cellValue,
  dateCell,
  exportSheet,
  moneyCell,
  totalCell,
  withSlug,
} from "./shared";

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
