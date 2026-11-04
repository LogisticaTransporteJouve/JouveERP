import { describe, expect, it, vi } from "vitest";

import {
  amountToInput,
  formatAmountInput,
  formatArDateShort,
  formatArgentineDate,
  formatArgentineDateTime,
  formatInteger,
  formatMoney,
  formatMoneySigned,
  formatNumber2,
  formatSignedAmountInput,
  nextMoneyInputText,
  normalizeAmountText,
  parseArAmount,
  parseStatementNumber,
  signedAmountToInput,
  todayInAR,
} from "./format";

describe("formatArgentineDate", () => {
  it("muestra una fecha yyyy-mm-dd como el mismo día calendario", () => {
    // A Postgres `date` has no time or zone: no AR shift applies.
    expect(formatArgentineDate("2026-05-17")).toBe("17 may 2026");
    expect(formatArgentineDate("2026-01-01")).toBe("1 ene 2026");
    expect(formatArgentineDate("2026-12-31")).toBe("31 dic 2026");
  });

  it("retorna '—' para una fecha yyyy-mm-dd inexistente", () => {
    expect(formatArgentineDate("2026-02-30")).toBe("—");
    expect(formatArgentineDate("2026-13-01")).toBe("—");
  });

  it("convierte timestamp ISO con offset AR aplicado", () => {
    // 2026-05-17T12:00:00Z → 09:00 ART → 17 may
    expect(formatArgentineDate("2026-05-17T12:00:00Z")).toBe("17 may 2026");
  });

  it("respeta offset AR (UTC-3) usando timestamp UTC", () => {
    // 2026-05-17T02:00:00Z → 2026-05-16T23:00:00 ART
    expect(formatArgentineDate("2026-05-17T02:00:00Z")).toBe("16 may 2026");
  });

  it("retorna '—' para null/undefined/vacío", () => {
    expect(formatArgentineDate(null)).toBe("—");
    expect(formatArgentineDate(undefined)).toBe("—");
    expect(formatArgentineDate("")).toBe("—");
  });

  it("retorna '—' para fechas inválidas", () => {
    expect(formatArgentineDate("not-a-date")).toBe("—");
  });
});

describe("formatArgentineDateTime", () => {
  it("convierte timestamp ISO a 'd mmm yyyy, hh:mm' en hora AR", () => {
    expect(formatArgentineDateTime("2026-05-17T15:30:00Z")).toBe(
      "17 may 2026, 12:30",
    );
  });

  it("zero-pads horas y minutos", () => {
    expect(formatArgentineDateTime("2026-05-17T09:05:00Z")).toBe(
      "17 may 2026, 06:05",
    );
  });

  it("retorna '—' para null/inválido", () => {
    expect(formatArgentineDateTime(null)).toBe("—");
    expect(formatArgentineDateTime("xx")).toBe("—");
  });

  it("muestra una fecha yyyy-mm-dd sin hora y sin correr el día", () => {
    expect(formatArgentineDateTime("2026-05-17")).toBe("17 may 2026");
  });
});

describe("formatArDateShort", () => {
  it("muestra una fecha yyyy-mm-dd como el mismo día calendario", () => {
    expect(formatArDateShort("2026-05-17")).toBe("17/5/2026");
    expect(formatArDateShort("2026-01-01")).toBe("1/1/2026");
  });

  it("lee timestamps en hora AR, sin depender de la zona del runtime", () => {
    // 2026-05-17T02:00:00Z → 2026-05-16T23:00 ART
    expect(formatArDateShort("2026-05-17T02:00:00Z")).toBe("16/5/2026");
    expect(formatArDateShort(new Date("2026-05-17T12:00:00Z"))).toBe(
      "17/5/2026",
    );
  });

  it("retorna '—' para null/inválido", () => {
    expect(formatArDateShort(null)).toBe("—");
    expect(formatArDateShort("xx")).toBe("—");
    expect(formatArDateShort(new Date("xx"))).toBe("—");
  });
});

describe("formatSignedAmountInput / signedAmountToInput", () => {
  it("mantiene el signo menos", () => {
    expect(formatSignedAmountInput("-1500,5")).toBe("-1.500,5");
    expect(formatSignedAmountInput(" -")).toBe("-");
    expect(formatSignedAmountInput("15-00")).toBe("1.500");
    expect(signedAmountToInput(-1234.56)).toBe("-1.234,56");
    expect(signedAmountToInput(1234.56)).toBe("1.234,56");
    expect(parseArAmount(signedAmountToInput(-1234.56))).toBe(-1234.56);
  });
});

describe("formatAmountInput", () => {
  it("agrega separadores de miles", () => {
    expect(formatAmountInput("1234567")).toBe("1.234.567");
    expect(formatAmountInput("100")).toBe("100");
    expect(formatAmountInput("1")).toBe("1");
  });

  it("acepta decimales con coma", () => {
    expect(formatAmountInput("1234,56")).toBe("1.234,56");
    expect(formatAmountInput("0,50")).toBe("0,50");
  });

  it("trunca decimales a 2", () => {
    expect(formatAmountInput("1,2345")).toBe("1,23");
  });

  it("elimina caracteres no permitidos", () => {
    // The '.' is not in the allowed set [\d,] → it's removed, leaving 123456,
    // then thousands are formatted → "123.456".
    expect(formatAmountInput("$1.234,56")).toBe("1.234,56");
    expect(formatAmountInput("abc123")).toBe("123");
  });

  it("normaliza leading zeros", () => {
    expect(formatAmountInput("007")).toBe("7");
    expect(formatAmountInput("0,5")).toBe("0,5");
  });

  it("inserta 0 cuando solo hay decimales", () => {
    expect(formatAmountInput(",50")).toBe("0,50");
  });

  it("retorna string vacío para input vacío", () => {
    expect(formatAmountInput("")).toBe("");
  });
});

describe("amountToInput", () => {
  it("convierte number a formato es-AR", () => {
    expect(amountToInput(1234.56)).toBe("1.234,56");
    expect(amountToInput(0)).toBe("0,00");
    expect(amountToInput(100)).toBe("100,00");
  });

  it("round-trip con formatAmountInput", () => {
    const original = 12345.67;
    const formatted = amountToInput(original);
    expect(formatAmountInput(formatted)).toBe(formatted);
  });

  it("trunca/redondea a 2 decimales vía toFixed", () => {
    expect(amountToInput(1.234)).toBe("1,23");
    expect(amountToInput(1.236)).toBe("1,24");
    expect(amountToInput(1.5)).toBe("1,50");
  });
});

describe("formatNumber2", () => {
  it("formatea con 2 decimales y separadores es-AR", () => {
    expect(formatNumber2(1234.5)).toBe("1.234,50");
    expect(formatNumber2(0)).toBe("0,00");
    expect(formatNumber2(1000000)).toBe("1.000.000,00");
  });

  it("acepta strings", () => {
    expect(formatNumber2("1234.5")).toBe("1.234,50");
  });

  it("retorna '0,00' para null/undefined/NaN", () => {
    expect(formatNumber2(null)).toBe("0,00");
    expect(formatNumber2(undefined)).toBe("0,00");
    expect(formatNumber2(NaN)).toBe("0,00");
    expect(formatNumber2("abc")).toBe("0,00");
  });

  it("respeta signo negativo", () => {
    expect(formatNumber2(-1234.5)).toBe("-1.234,50");
  });
});

describe("formatInteger", () => {
  it("redondea y omite decimales", () => {
    expect(formatInteger(1234.7)).toBe("1.235");
    expect(formatInteger(1234.3)).toBe("1.234");
    expect(formatInteger(0)).toBe("0");
  });

  it("retorna '0' para null/NaN", () => {
    expect(formatInteger(null)).toBe("0");
    expect(formatInteger(NaN)).toBe("0");
  });
});

describe("formatMoney", () => {
  it("ARS por default", () => {
    expect(formatMoney(1234.5)).toBe("$ 1.234,50");
    expect(formatMoney(1234.5, "ARS")).toBe("$ 1.234,50");
  });

  it("USD usa prefijo US$", () => {
    expect(formatMoney(1234.5, "USD")).toBe("US$ 1.234,50");
  });

  it("currency desconocida usa $", () => {
    expect(formatMoney(100, "EUR")).toBe("$ 100,00");
  });

  it("null/undefined → '$ 0,00'", () => {
    expect(formatMoney(null)).toBe("$ 0,00");
    expect(formatMoney(undefined)).toBe("$ 0,00");
  });
});

describe("formatMoneySigned", () => {
  it("respeta negativos con signo afuera del símbolo", () => {
    expect(formatMoneySigned(-1234.5)).toBe("-$ 1.234,50");
    expect(formatMoneySigned(-1234.5, "USD")).toBe("-US$ 1.234,50");
  });

  it("positivo idéntico a formatMoney", () => {
    expect(formatMoneySigned(1234.5)).toBe("$ 1.234,50");
  });

  it("cero no lleva signo", () => {
    expect(formatMoneySigned(0)).toBe("$ 0,00");
  });
});

describe("todayInAR", () => {
  it("devuelve YYYY-MM-DD válido", () => {
    expect(todayInAR()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("aplica shift UTC-3 (formato y rango plausible)", () => {
    const today = todayInAR();
    // Re-compute to compare and ensure it doesn't use pure UTC
    const ar = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(today).toBe(ar);
  });

  it("after 21:00 in Argentina it is still the Argentine day, not UTC's", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-03T02:30:00Z"));
      expect(todayInAR()).toBe("2026-11-02");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseArAmount", () => {
  it.each([
    ["1.234", 1234],
    ["1,5", 1.5],
    ["150.000", 150000],
    ["1.500.000,50", 1500000.5],
    ["-0,01", -0.01],
    ["", null],
    ["abc", null],
    ["12abc", null],
    ["15.000,5O", null],
    ["1e3", null],
    ["1,2,3", null],
    ["-", null],
    ["1.500,", 1500],
    [",5", 0.5],
    [" 1.234,56 ", 1234.56],
  ])("lee %s como %s", (raw, expected) => {
    expect(parseArAmount(raw)).toBe(expected);
  });

  it("vuelve de amountToInput al mismo número", () => {
    expect(parseArAmount(amountToInput(850000.5))).toBe(850000.5);
  });
});

describe("normalizeAmountText", () => {
  it.each([
    // both marks: the last one is the decimal
    ["1.234,56", "1234,56"],
    ["1,234.56", "1234,56"],
    ["1.234.567,8", "1234567,8"],
    // only a comma: the decimal
    ["1500,5", "1500,5"],
    // one dot: thousands with exactly 3 digits after it, else decimal
    ["15.000", "15000"],
    ["1500.5", "1500,5"],
    ["1500.50", "1500,50"],
    ["15.", "15,"],
    // several dots: thousands
    ["1.234.567", "1234567"],
    ["-1.234,5", "-1234,5"],
    ["1234", "1234"],
  ])("reads %s as %s", (raw, expected) => {
    expect(normalizeAmountText(raw)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3", "-", "1e3", "12a"])("refuses %s", (raw) => {
    expect(normalizeAmountText(raw)).toBeNull();
  });
});

describe("parseArAmount separator rules", () => {
  it.each([
    ["1,234.56", 1234.56],
    ["1500.5", 1500.5],
    ["15.000", 15000],
    ["1.234.567", 1234567],
  ])("lee %s como %s", (raw, expected) => {
    expect(parseArAmount(raw)).toBe(expected);
  });
});

describe("nextMoneyInputText", () => {
  function typeKeys(keys: string, opts?: { decimals?: number }): string {
    let text = "";
    for (const key of keys) text = nextMoneyInputText(text, text + key, opts);
    return text;
  }

  it.each([
    ["1500.50", "1.500,50"],
    ["1500,50", "1.500,50"],
    ["1500.5.0", "1.500,50"],
    ["1500,5,0", "1.500,50"],
    [".5", "0,5"],
  ])("typing %s shows %s", (keys, shown) => {
    expect(typeKeys(keys)).toBe(shown);
  });

  it("keeps the decimals cap when a dot is typed", () => {
    expect(typeKeys("1.23456", { decimals: 4 })).toBe("1,2345");
  });

  it("turns a dot typed in the middle into the decimal mark", () => {
    expect(nextMoneyInputText("1.500", "1..500")).toBe("1,50");
  });

  it.each([
    ["1.234,56", "1.234,56"],
    ["1,234.56", "1.234,56"],
    ["15.000", "15.000"],
    ["1500.5", "1.500,5"],
    ["1.234.567", "1.234.567"],
    ["$ 2.000", "2.000"],
  ])("pasting %s shows %s", (pasted, shown) => {
    expect(nextMoneyInputText("", pasted)).toBe(shown);
  });

  it("reads a paste over the current value as the new value", () => {
    expect(nextMoneyInputText("0", "1.500")).toBe("1.500");
    expect(nextMoneyInputText("100,00", "15.000")).toBe("15.000");
    expect(nextMoneyInputText("100,00", "1500.5")).toBe("1.500,5");
  });

  it("joins pasted digits to what was there", () => {
    expect(nextMoneyInputText("1.500", "1.50050")).toBe("150.050");
  });

  it("ignores a paste that is not an amount", () => {
    expect(nextMoneyInputText("1.500", "1.500abc")).toBe("1.500");
  });

  it("keeps a minus only with allowNegative", () => {
    expect(nextMoneyInputText("", "-1500.5", { allowNegative: true })).toBe(
      "-1.500,5",
    );
    expect(nextMoneyInputText("", "-1500.5")).toBe("1.500,5");
  });
});

describe("parseStatementNumber", () => {
  it("reads es-AR text and raw cell values", () => {
    expect(parseStatementNumber("$ 1.234,56")).toBe(1234.56);
    expect(parseStatementNumber("12.500")).toBe(12500);
    expect(parseStatementNumber("1.234.567")).toBe(1234567);
    expect(parseStatementNumber("1234.56")).toBe(1234.56);
    expect(parseStatementNumber("250,5")).toBe(250.5);
    expect(parseStatementNumber("ARS 300")).toBe(300);
  });

  it("returns null for what is not a number", () => {
    expect(parseStatementNumber("")).toBeNull();
    expect(parseStatementNumber("abc")).toBeNull();
    expect(parseStatementNumber("12a")).toBeNull();
  });
});
