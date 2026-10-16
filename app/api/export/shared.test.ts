import { describe, expect, it } from "vitest";

import {
  cellText,
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
