import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildXlsx,
  xlsxSheetData,
  xlsxSheetName,
  type XlsxSheet,
} from "./xlsx";

const INJECTIONS = [
  '=HYPERLINK("http://x","y")',
  "+54 11 5555",
  "-2+3",
  "@SUM(A1)",
  "=cmd|' /C calc'!A0",
];

async function unzip(sheet: XlsxSheet): Promise<Record<string, string>> {
  const blob = await buildXlsx(sheet);
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]),
  );
}

describe("xlsxSheetName", () => {
  it("drops the characters Excel forbids and caps at 31", () => {
    expect(xlsxSheetName("Ventas [2026]: a/b\\c*d?")).toBe(
      "Ventas 2026 a b c d",
    );
    expect(xlsxSheetName("x".repeat(40))).toHaveLength(31);
    expect(xlsxSheetName("'Saldo'")).toBe("Saldo");
    // An apostrophe the cut leaves at the end goes too.
    expect(xlsxSheetName(`${"x".repeat(30)}'abc`)).toBe("x".repeat(30));
  });

  it("falls back for blank and reserved names", () => {
    expect(xlsxSheetName("  []  ")).toBe("Hoja 1");
    expect(xlsxSheetName("History")).toBe("Hoja 1");
  });
});

describe("xlsxSheetData", () => {
  it("writes a bold header with the column's currency", () => {
    const { data } = xlsxSheetData({
      name: "s",
      columns: [
        { header: "Cliente" },
        { header: "Total", type: "money" },
        { header: "Saldo", type: "money", currency: "USD" },
        { header: "Margen", type: "percent" },
      ],
      rows: [],
    });
    expect(data[0]).toEqual([
      { type: String, value: "Cliente", fontWeight: "bold" },
      { type: String, value: "Total (ARS)", fontWeight: "bold" },
      { type: String, value: "Saldo (USD)", fontWeight: "bold" },
      { type: String, value: "Margen (%)", fontWeight: "bold" },
    ]);
  });

  it("writes numbers and money as numeric cells", () => {
    const { data } = xlsxSheetData({
      name: "s",
      columns: [
        { header: "Total", type: "money" },
        { header: "Cantidad", type: "integer" },
        { header: "Margen", type: "percent" },
        { header: "Litros", type: "number" },
      ],
      rows: [[-1500.25, "12", 12.5, "3.5"]],
    });
    expect(data[1]).toEqual([
      { type: Number, value: -1500.25, format: "#,##0.00" },
      { type: Number, value: 12, format: "#,##0" },
      { type: Number, value: 12.5, format: '#,##0.00" %"' },
      { type: Number, value: 3.5 },
    ]);
  });

  it("names a single currency in the header and a mixed one in each cell", () => {
    const single = xlsxSheetData({
      name: "s",
      columns: [{ header: "Importe" }],
      rows: [[{ money: 10, currency: "USD" }], [{ money: 5, currency: "USD" }]],
    });
    expect(single.data[0]?.[0]).toMatchObject({ value: "Importe (USD)" });
    expect(single.data[1]?.[0]).toEqual({
      type: Number,
      value: 10,
      format: "#,##0.00",
    });

    const mixed = xlsxSheetData({
      name: "s",
      columns: [{ header: "Importe" }],
      rows: [[{ money: 10, currency: "USD" }], [{ money: 5, currency: "ARS" }]],
    });
    expect(mixed.data[0]?.[0]).toMatchObject({ value: "Importe" });
    expect(mixed.data[1]?.[0]).toMatchObject({ format: '"US$ "#,##0.00' });
    expect(mixed.data[2]?.[0]).toMatchObject({ format: '"$ "#,##0.00' });
  });

  it("writes dates as date cells, timestamps in Argentina's time", () => {
    const { data } = xlsxSheetData({
      name: "s",
      columns: [{ header: "Fecha", type: "date" }, { header: "Alta" }],
      rows: [
        ["2026-06-05", { date: "2026-06-05T02:30:00Z" }],
        ["2026-02-31", null],
      ],
    });
    expect(data[1]).toEqual([
      {
        type: Date,
        value: new Date(Date.UTC(2026, 5, 5)),
        format: "dd/mm/yyyy",
      },
      {
        type: Date,
        value: new Date(Date.UTC(2026, 5, 4, 23, 30)),
        format: "dd/mm/yyyy hh:mm",
      },
    ]);
    // Not a real day: kept as the text it is.
    expect(data[2]?.[0]).toEqual({ type: String, value: "2026-02-31" });
  });

  it("keeps codes as text with their leading zeros", () => {
    const { data } = xlsxSheetData({
      name: "s",
      columns: [
        { header: "CUIT" },
        { header: "Número" },
        { header: "cost_center_code" },
        { header: "Cantidad", type: "number" },
      ],
      rows: [["20123456789", "0001-00000042", "007", "0012"]],
    });
    expect(data[1]).toEqual([
      { type: String, value: "20123456789" },
      { type: String, value: "0001-00000042" },
      { type: String, value: "007" },
      { type: String, value: "0012" },
    ]);
  });

  it("keeps formula-like text as plain strings in any column", () => {
    const { data } = xlsxSheetData({
      name: "s",
      columns: [{ header: "Texto" }, { header: "Monto", type: "money" }],
      rows: INJECTIONS.map((text) => [text, text]),
    });
    for (const [i, text] of INJECTIONS.entries()) {
      expect(data[i + 1]).toEqual([
        { type: String, value: text },
        { type: String, value: text },
      ]);
    }
  });

  it("writes empty cells for null and the app's dash, words for booleans", () => {
    const { data } = xlsxSheetData({
      name: "s",
      columns: [{ header: "a" }, { header: "b" }, { header: "c" }],
      rows: [[null, "—", true]],
    });
    expect(data[1]).toEqual([null, null, { type: String, value: "Sí" }]);
  });

  it("bolds the totals row and sizes columns to their content", () => {
    const { data, widths } = xlsxSheetData({
      name: "s",
      columns: [{ header: "Cliente" }, { header: "Total", type: "money" }],
      rows: [["Transportes del Sur S.A.", 1234567.89]],
      totals: ["Total", 1234567.89],
    });
    expect(data[2]).toEqual([
      { type: String, value: "Total", fontWeight: "bold" },
      {
        type: Number,
        value: 1234567.89,
        format: "#,##0.00",
        fontWeight: "bold",
      },
    ]);
    expect(widths).toEqual([26, 14]);
  });
});

describe("xlsxSheetData preamble", () => {
  it("writes context lines above the header and freezes below it", () => {
    const { data, frozenRows, widths } = xlsxSheetData({
      name: "s",
      preamble: ["Comprobantes", "Período: Todo el historial"],
      columns: [{ header: "Cliente" }],
      rows: [["Acme"]],
    });
    expect(data[0]).toEqual([
      { type: String, value: "Comprobantes", fontWeight: "bold" },
    ]);
    expect(data[1]).toEqual([
      { type: String, value: "Período: Todo el historial" },
    ]);
    expect(data[2]).toEqual([null]);
    expect(data[3]).toEqual([
      { type: String, value: "Cliente", fontWeight: "bold" },
    ]);
    expect(frozenRows).toBe(4);
    // Context lines don't widen the first column.
    expect(widths).toEqual([9]);
  });

  it("drops lone surrogates and keeps paired ones", () => {
    const { data } = xlsxSheetData({
      name: "s",
      columns: [{ header: "a" }],
      rows: [["x\uD800y\uDC00z 😀"]],
    });
    expect(data[1]).toEqual([{ type: String, value: "xyz 😀" }]);
  });
});

describe("buildXlsx", () => {
  it("freezes the header and stores injection strings as shared text", async () => {
    const files = await unzip({
      name: "Prueba: [x]",
      columns: [{ header: "Texto" }, { header: "Total", type: "money" }],
      rows: INJECTIONS.map((text) => [text, 10]),
    });
    const sheet = files["xl/worksheets/sheet1.xml"] ?? "";
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('ySplit="1"');
    const withPreamble = await unzip({
      name: "p",
      preamble: ["Título"],
      columns: [{ header: "a" }],
      rows: [],
    });
    expect(withPreamble["xl/worksheets/sheet1.xml"]).toContain('ySplit="3"');
    expect(sheet).not.toContain("<f>");
    const strings = files["xl/sharedStrings.xml"] ?? "";
    expect(strings).toContain("<t>=cmd|' /C calc'!A0</t>");
    expect(strings).toContain("<t>@SUM(A1)</t>");
    expect(files["xl/workbook.xml"]).toContain('name="Prueba x"');
  });
});
