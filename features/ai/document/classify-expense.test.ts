import { describe, expect, it } from "vitest";

import {
  buildExpensePrompt,
  classifyExpense,
  UNMAPPED,
  type ExpenseClassifyInput,
} from "./classify-expense";

const base: ExpenseClassifyInput = {
  supplierName: "YPF SA",
  supplierCategory: "combustible",
  invoiceNeto: 100000,
  lineDescriptions: ["Gasoil grado 2", "Nafta súper"],
  leafAccounts: [
    { code: "5.2.1", name: "Combustible" },
    { code: "5.2.2", name: "Mantenimiento" },
  ],
  costCenters: [{ code: "CC1", name: "Flota" }],
};

describe("buildExpensePrompt", () => {
  it("includes accounts, supplier and the UNMAPPED instruction", () => {
    const p = buildExpensePrompt(base);
    expect(p).toContain("5.2.1 — Combustible");
    expect(p).toContain("YPF SA");
    expect(p).toContain("combustible");
    expect(p).toContain("UNMAPPED");
  });
});

describe("classifyExpense", () => {
  it("returns UNMAPPED without calling the model when there are no leaves", async () => {
    const r = await classifyExpense({ ...base, leafAccounts: [] });
    expect(r.accountCode).toBe(UNMAPPED);
    expect(r.confidence).toBe(0);
    expect(r.accountName).toBeNull();
  });
});
