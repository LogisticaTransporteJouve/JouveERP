import { describe, expect, it } from "vitest";

import { csvField, csvFileName, toCsv } from "./csv";

describe("csvField", () => {
  it("prefixes text a spreadsheet would run as a formula", () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe(
      '"\'=HYPERLINK(""http://x"")"',
    );
    expect(csvField("+54 11")).toBe("'+54 11");
    expect(csvField("-2+3")).toBe("'-2+3");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("\tcmd")).toBe("'\tcmd");
    expect(csvField("\rcmd")).toBe('"\'\rcmd"');
  });

  it("keeps numbers and numeric strings numeric", () => {
    expect(csvField(-1500.25)).toBe("-1500.25");
    expect(csvField("-1500.25")).toBe("-1500.25");
    expect(csvField(Number.NaN)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvField("Pérez, Ana")).toBe('"Pérez, Ana"');
    expect(csvField('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });

  it("writes empty cells for null and undefined, and booleans as words", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(true)).toBe("true");
  });
});

describe("toCsv", () => {
  it("joins a header and rows with CRLF, escaping headers too", () => {
    expect(
      toCsv(
        ["Cliente", "=Total"],
        [
          ["Acme", 10],
          ["=cmd|' /C calc'!A0", null],
        ],
      ),
    ).toBe("Cliente,'=Total\r\nAcme,10\r\n'=cmd|' /C calc'!A0,");
  });
});

describe("csvFileName", () => {
  it("slugs the title", () => {
    expect(csvFileName("Gastos por categoría — 2026")).toBe(
      "gastos-por-categoria-2026.csv",
    );
    expect(csvFileName("¡¿?!")).toBe("export.csv");
  });
});
