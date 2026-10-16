import { describe, expect, it } from "vitest";

import { cellText, dateCell, exportSheet, moneyCell } from "./shared";

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
    const sheet = exportSheet({
      title: "Vehículos",
      columns: [
        { header: "Patente", width: 90 },
        { header: "Año", width: 50, align: "right" },
        { header: "Total", width: 90, align: "right" },
      ],
      rows: [["AB123CD", "2020", moneyCell(10)]],
      totalsRow: ["Total", "", moneyCell(10)],
      fileName: "vehiculos",
    });
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
