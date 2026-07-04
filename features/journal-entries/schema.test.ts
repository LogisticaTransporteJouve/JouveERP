import { describe, expect, it } from "vitest";

import {
  accrualPeriodFromDate,
  currentPeriod,
  isKnownSource,
  isPeriodFormat,
  ManualJournalEntryCreateSchema,
} from "./schema";

describe("isKnownSource", () => {
  it("true para fuentes conocidas", () => {
    expect(isKnownSource("transactions")).toBe(true);
    expect(isKnownSource("invoices")).toBe(true);
    expect(isKnownSource("receipts")).toBe(true);
    expect(isKnownSource("payment_orders")).toBe(true);
  });

  it("false para null o desconocidas", () => {
    expect(isKnownSource(null)).toBe(false);
    expect(isKnownSource("foo")).toBe(false);
    expect(isKnownSource("Invoices")).toBe(false);
  });
});

describe("isPeriodFormat", () => {
  it("acepta YYYY-MM válido", () => {
    expect(isPeriodFormat("2026-01")).toBe(true);
    expect(isPeriodFormat("2026-12")).toBe(true);
  });

  it("rechaza mes fuera de rango", () => {
    expect(isPeriodFormat("2026-00")).toBe(false);
    expect(isPeriodFormat("2026-13")).toBe(false);
  });

  it("rechaza formatos mal armados", () => {
    expect(isPeriodFormat("2026/01")).toBe(false);
    expect(isPeriodFormat("26-01")).toBe(false);
    expect(isPeriodFormat("2026-1")).toBe(false);
    expect(isPeriodFormat("")).toBe(false);
  });
});

describe("currentPeriod", () => {
  it("retorna formato YYYY-MM", () => {
    expect(isPeriodFormat(currentPeriod())).toBe(true);
  });
});

describe("accrualPeriodFromDate", () => {
  it("recorta YYYY-MM-DD a YYYY-MM", () => {
    expect(accrualPeriodFromDate("2026-07-04")).toBe("2026-07");
  });
});

describe("ManualJournalEntryCreateSchema", () => {
  const ACC_A = "11111111-1111-4111-8111-111111111111";
  const ACC_B = "22222222-2222-4222-8222-222222222222";

  const base = {
    entry_date: "2026-07-04",
    description: "Ajuste por inflación RG 4667 — período 2026-06",
    lines: [
      { account_id: ACC_A, debit: 1000, credit: 0 },
      { account_id: ACC_B, debit: 0, credit: 1000 },
    ],
  };

  it("acepta un asiento balanceado de dos líneas", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("rechaza Debe ≠ Haber", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse({
      ...base,
      lines: [
        { account_id: ACC_A, debit: 1000, credit: 0 },
        { account_id: ACC_B, debit: 0, credit: 999.99 },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/no balancea/);
  });

  it("acepta diferencias por debajo del centavo", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse({
      ...base,
      lines: [
        { account_id: ACC_A, debit: 333.333, credit: 0 },
        { account_id: ACC_B, debit: 0, credit: 333.329 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza el asiento por cero", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse({
      ...base,
      lines: [
        { account_id: ACC_A, debit: 0, credit: 0 },
        { account_id: ACC_B, debit: 0, credit: 0 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rechaza una línea con Debe y Haber a la vez", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse({
      ...base,
      lines: [
        { account_id: ACC_A, debit: 1000, credit: 500 },
        { account_id: ACC_B, debit: 0, credit: 500 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rechaza menos de dos líneas", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse({
      ...base,
      lines: [{ account_id: ACC_A, debit: 0, credit: 0 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rechaza descripción vacía", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse({
      ...base,
      description: "  ",
    });
    expect(parsed.success).toBe(false);
  });

  it("rechaza importes negativos", () => {
    const parsed = ManualJournalEntryCreateSchema.safeParse({
      ...base,
      lines: [
        { account_id: ACC_A, debit: -100, credit: 0 },
        { account_id: ACC_B, debit: 0, credit: -100 },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
