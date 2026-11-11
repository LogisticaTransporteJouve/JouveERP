import { describe, expect, it } from "vitest";

import { latestDefinition } from "@/lib/db/testing/migration-sql";

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
  it("explains the closed-period guard with what to do", () => {
    expect(
      payrollDbErrorMessage(
        {
          code: "55006",
          hint: "jouve_guard",
          message:
            "El período contable 2026-10 está cerrado y no admite movimientos",
        },
        "x",
      ),
    ).toMatch(/Reabrilo en Contabilidad/);
  });

  it("the closed-period guard still raises the message it detects", () => {
    expect(latestDefinition("guard_journal_period_closed")).toContain(
      "'El período contable % está cerrado y no admite movimientos'",
    );
  });

  it("keeps an already actionable closed-period message", () => {
    const message =
      "El período contable 2026-10 está cerrado: el asiento del movimiento no se puede rehacer. Pedí que lo reabran en Contabilidad.";
    expect(
      payrollDbErrorMessage(
        { code: "55006", hint: "jouve_guard", message },
        "x",
      ),
    ).toBe(message);
  });

  it("keeps another guard's own message on the same SQLSTATE", () => {
    const message =
      "El movimiento está conciliado con el extracto bancario: desconciliá su línea en la pestaña «Extracto» de su cuenta antes de editarlo.";
    expect(
      payrollDbErrorMessage(
        { code: "55006", hint: "jouve_guard", message },
        "x",
      ),
    ).toBe(message);
  });

  it("passes through the unhinted payroll guards", () => {
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

  it("hides raw Postgres text behind the fallback", () => {
    expect(
      payrollDbErrorMessage(
        { code: "55006", message: "raw object in use" },
        "No se pudo.",
      ),
    ).toBe("No se pudo.");
    expect(
      payrollDbErrorMessage(
        {
          code: "23514",
          message:
            'new row for relation "payroll_payments" violates check constraint "x"',
        },
        "No se pudo.",
      ),
    ).toBe("No se pudo.");
    expect(
      payrollDbErrorMessage(
        { code: "57014", message: "canceling statement due to timeout" },
        "No se pudo.",
      ),
    ).toBe("No se pudo.");
  });

  it("falls back when there is no error detail", () => {
    expect(payrollDbErrorMessage(null, "No se pudo.")).toBe("No se pudo.");
  });
});
