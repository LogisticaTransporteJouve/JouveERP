import { describe, expect, it } from "vitest";

import {
  exceedsBalance,
  payrollDbErrorMessage,
  payrollPayableAccounts,
} from "./payroll-payments";

describe("payrollPayableAccounts", () => {
  const accounts = [
    { id: "usd", is_active: true, currency: "USD", type: "bank" as const },
    { id: "galicia", is_active: true, currency: "ARS", type: "bank" as const },
    { id: "caja", is_active: true, currency: "ARS", type: "cash" as const },
    { id: "old", is_active: false, currency: "ARS", type: "bank" as const },
    {
      id: "cartera",
      is_active: true,
      currency: "ARS",
      type: "checks" as const,
    },
    { id: "echeq", is_active: true, currency: "ARS", type: "echeq" as const },
  ];

  it("keeps only active ARS cash and bank accounts", () => {
    expect(payrollPayableAccounts(accounts).map((a) => a.id)).toEqual([
      "galicia",
      "caja",
    ]);
  });

  it("never offers a USD account first, even if it sorts first", () => {
    expect(payrollPayableAccounts(accounts)[0]?.currency).toBe("ARS");
  });
});

describe("exceedsBalance", () => {
  it("allows paying exactly the balance", () => {
    expect(exceedsBalance(1_000, 1_000)).toBe(false);
  });

  it("ignores rounding below a cent", () => {
    expect(exceedsBalance(1_000.005, 1_000)).toBe(false);
  });

  it("flags a payment above the balance", () => {
    expect(exceedsBalance(1_000.5, 1_000)).toBe(true);
  });

  it("treats a negative balance as nothing left to pay", () => {
    expect(exceedsBalance(1, -50)).toBe(true);
  });
});

describe("payrollDbErrorMessage", () => {
  it("explains a closed accounting period", () => {
    expect(
      payrollDbErrorMessage({ code: "55006", message: "raw" }, "x"),
    ).toMatch(/período contable/);
  });

  it("passes through guard messages", () => {
    expect(
      payrollDbErrorMessage(
        {
          code: "23514",
          message: "Los sueldos se pagan desde una cuenta en pesos",
        },
        "x",
      ),
    ).toBe("Los sueldos se pagan desde una cuenta en pesos");
  });

  it("falls back when there is no error detail", () => {
    expect(payrollDbErrorMessage(null, "No se pudo.")).toBe("No se pudo.");
  });
});
