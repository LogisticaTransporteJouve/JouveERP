import { describe, expect, it } from "vitest";

import {
  balanceRangeHint,
  computeBalanceSheetEquity,
  computeBalanceTotals,
  computeEERR,
  groupByType,
  netResult,
  resultsStart,
  type AccountBalanceRow,
} from "./schema";

const row = (over: Partial<AccountBalanceRow>): AccountBalanceRow => ({
  account_id: "x",
  account_code: "1.1",
  account_name: "Cuenta",
  account_type: "activo",
  eerr_category: null,
  total_debit: 0,
  total_credit: 0,
  balance: 0,
  ...over,
});

describe("computeBalanceTotals", () => {
  it("acumula débito y crédito + valida balance", () => {
    const totals = computeBalanceTotals([
      row({ total_debit: 1000, total_credit: 0, balance: 1000 }),
      row({ total_debit: 0, total_credit: 1000, balance: -1000 }),
    ]);
    expect(totals.totalDebit).toBe(1000);
    expect(totals.totalCredit).toBe(1000);
    expect(totals.isBalanced).toBe(true);
  });
});

describe("groupByType", () => {
  it("agrupa por tipo en orden activo/pasivo/...", () => {
    const grouped = groupByType([
      row({ account_type: "pasivo", balance: -500 }),
      row({ account_type: "activo", balance: 1000 }),
      row({ account_type: "patrimonio", balance: -500 }),
    ]);
    expect(grouped.map((g) => g.type)).toEqual([
      "activo",
      "pasivo",
      "patrimonio",
    ]);
  });
});

describe("computeEERR", () => {
  const res = (
    type: "resultado_positivo" | "resultado_negativo",
    eerr_category: string | null,
    balance: number,
    account_code = "4.1.1",
  ) => row({ account_type: type, eerr_category, balance, account_code });

  it("cascades from sales to the period's result", () => {
    const eerr = computeEERR([
      res("resultado_positivo", "ingresos_operativos", -10000),
      res("resultado_negativo", "costo", 4000),
      res("resultado_negativo", "gastos_operativos", 1000),
      res("resultado_negativo", "gastos_administrativos", 500),
      res("resultado_positivo", "ingresos_financieros", -300),
      res("resultado_negativo", "gastos_financieros", 800),
      row({ account_type: "activo", balance: 99999 }),
    ]);
    expect(
      eerr.steps.map((s) => [
        s.kind === "subtotal" ? "=" : "",
        s.label,
        s.total,
      ]),
    ).toEqual([
      ["", "Ventas", 10000],
      ["", "Costo de los servicios", -4000],
      ["=", "Resultado bruto", 6000],
      ["", "Gastos operativos", -1000],
      ["", "Gastos de administración", -500],
      ["=", "Resultado operativo", 4500],
      ["", "Resultados financieros", -500],
      ["=", "Resultado antes de impuestos", 4000],
    ]);
    expect(eerr.resultado).toBe(4000);
  });

  it("puts an unknown or missing category in other results, so the total closes", () => {
    const eerr = computeEERR([
      res("resultado_positivo", "ventas_viejas", -700),
      res("resultado_negativo", null, 200),
    ]);
    const otros = eerr.steps.find(
      (s) => s.label === "Otros ingresos y egresos",
    );
    expect(otros?.total).toBe(500);
    expect(eerr.resultado).toBe(500);
  });

  it("matches the net result of the same accounts", () => {
    const rows = [
      res("resultado_positivo", "ingresos_operativos", -1234.56),
      res("resultado_negativo", "costo", 234.5),
      res("resultado_negativo", "x", 10),
    ];
    expect(computeEERR(rows).resultado).toBeCloseTo(netResult(rows), 6);
  });
});

describe("computeBalanceSheetEquity", () => {
  it("shows the period's result, and earlier results apart", () => {
    // Since inception: sales 1000, expenses 300; in the period: sales 400,
    // expenses 100. Capital 500.
    const cumulative = [
      row({ account_type: "patrimonio", balance: -500 }),
      row({ account_type: "resultado_positivo", balance: -1000 }),
      row({ account_type: "resultado_negativo", balance: 300 }),
    ];
    const period = [
      row({ account_type: "resultado_positivo", balance: -400 }),
      row({ account_type: "resultado_negativo", balance: 100 }),
    ];
    const equity = computeBalanceSheetEquity(cumulative, period);
    expect(equity.resultadoPeriodo).toBe(300);
    expect(equity.resultadosAnteriores).toBe(400);
    // Capital + every result: the equation Activo = Pasivo + PN still holds.
    expect(equity.totalPatrimonio).toBe(1200);
  });
});

describe("results of the fiscal year (October start)", () => {
  it("without «Desde», starts the results on the ejercicio's first month", () => {
    expect(resultsStart("2026-03", null, 10)).toBe("2025-10");
    expect(resultsStart("2026-09", null, 10)).toBe("2025-10");
    expect(resultsStart("2026-10", null, 10)).toBe("2026-10");
    expect(resultsStart("2026-11", null, 10)).toBe("2026-10");
  });

  it("with «Desde», starts the results there", () => {
    expect(resultsStart("2026-03", "2026-01", 10)).toBe("2026-01");
  });

  it("names the ejercicio and its months in the hint", () => {
    expect(balanceRangeHint("2026-03", null, 10)).toBe(
      "Sin 'desde': saldos acumulados hasta el corte; resultados del ejercicio 2025/26 (oct 2025 – mar 2026).",
    );
    expect(balanceRangeHint("2026-11", null, 10)).toContain(
      "ejercicio 2026/27 (oct 2026 – nov 2026)",
    );
    expect(balanceRangeHint("2026-03", null, 1)).toContain(
      "ejercicio 2026 (ene 2026 – mar 2026)",
    );
    expect(balanceRangeHint("2026-03", "2026-01", 10)).toBe(
      "Mostrando movimientos del rango ene 2026 a mar 2026.",
    );
  });
});
