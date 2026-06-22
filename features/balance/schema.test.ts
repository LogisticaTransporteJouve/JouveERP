import { describe, expect, it } from "vitest";

import {
  computeBalanceTotals,
  computeEERR,
  groupByType,
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
    expect(grouped.map((g) => g.type)).toEqual(["activo", "pasivo", "patrimonio"]);
  });
});

describe("computeEERR", () => {
  it("calcula resultado = ingresos - gastos invirtiendo signos de positivos", () => {
    const eerr = computeEERR([
      row({
        account_type: "resultado_positivo",
        eerr_category: "ventas",
        balance: -10000, // credit → income of 10000
      }),
      row({
        account_type: "resultado_negativo",
        eerr_category: "gastos_op",
        balance: 3000, // debit → expense of 3000
      }),
    ]);
    expect(eerr.ingresos.total).toBe(10000);
    expect(eerr.gastos.total).toBe(3000);
    expect(eerr.resultado).toBe(7000);
  });

  it("agrupa ingresos por eerr_category", () => {
    const eerr = computeEERR([
      row({ account_type: "resultado_positivo", eerr_category: "ventas", balance: -1000 }),
      row({ account_type: "resultado_positivo", eerr_category: "ventas", balance: -500 }),
      row({ account_type: "resultado_positivo", eerr_category: "otros", balance: -200 }),
    ]);
    const ventas = eerr.ingresos.categories.find((c) => c.name === "ventas");
    expect(ventas?.total).toBe(1500);
  });
});
