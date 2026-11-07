import { describe, expect, it } from "vitest";

import {
  fixedCapitalPlan,
  frenchPlan,
  frenchPlanWith,
  parseBankPlan,
} from "./bank-plan";

// Two rows of Banco Macro's «Plan de cuotas» as the browser copies them.
const MACRO = `Num. de cuota	Vencimiento	Total a pagar	Capital	Otro capital	Intereses	Seguro	Otros rubros	IVA	Estado
11	03/11/2026	$ 1.858.377,66	$ 1.725.520,13	$ 0,00	$ 116.952,05	$ 0,00	$ 3.625,51	$ 12.279,97	Pagada
12	03/12/2026	$ 1.850.555,27	$ 1.783.037,51	$ 0,00	$ 59.434,65	$ 0,00	$ 1.842,47	$ 6.240,64	Vence el 03/12/2026`;

function rows(from: number) {
  return MACRO.replace("\n11\t", `\n${from}\t`).replace(
    "\n12\t",
    `\n${from + 1}\t`,
  );
}

describe("parseBankPlan", () => {
  it("reads Macro's plan: split, due date and whether it is paid", () => {
    const r = parseBankPlan(rows(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      {
        number: 1,
        due_date: "2026-11-03",
        amount: 1858377.66,
        capital: 1725520.13,
        interest: 116952.05,
        iva: 12279.97,
        perception: 0,
        other: 3625.51,
        paid: true,
      },
      expect.objectContaining({ number: 2, paid: false, amount: 1850555.27 }),
    ]);
  });

  it("reads the cells one per line too", () => {
    const r = parseBankPlan(rows(1).replace(/\t/g, "\n"));
    expect(r.ok && r.rows.length).toBe(2);
  });

  it("asks for the whole table when cuotas are missing", () => {
    const r = parseBankPlan(MACRO);
    expect(r.ok).toBe(false);
  });

  it("says when nothing looks like a plan", () => {
    expect(parseBankPlan("hola").ok).toBe(false);
  });
});

describe("frenchPlan", () => {
  it("keeps capital + interest equal and pays the principal off", () => {
    const plan = frenchPlan(18_000_000, 40, 12, "2026-01-03");
    expect(plan).toHaveLength(12);
    expect(plan[1]?.due_date).toBe("2026-02-03");
    const capital = plan.reduce((s, p) => s + p.capital, 0);
    expect(Math.round(capital * 100) / 100).toBe(18_000_000);
    expect(
      Math.abs((plan[0]?.amount ?? 0) - (plan[5]?.amount ?? 0)),
    ).toBeLessThan(0.02);
    expect(plan[0]?.interest).toBe(600000);
  });
});

describe("Banco Provincia's plans", () => {
  it("1666007/8: fixed capital, interest by days in its own cuota", () => {
    const plan = fixedCapitalPlan(60_000_000, 42, 12, "2026-02-15", {
      interestByDays: true,
      startDate: "2026-01-15",
      separateInterest: true,
      paidCount: 18,
    });
    expect(plan).toHaveLength(24);
    expect(
      plan.slice(0, 4).map((p) => [p.number, p.capital, p.interest]),
    ).toEqual([
      [1, 5_000_000, 0],
      [2, 0, 2140273.97],
      [3, 5_000_000, 0],
      [4, 0, 1772054.79],
    ]);
    expect(plan[17]?.paid).toBe(true);
    expect(plan[18]?.paid).toBe(false);
  });

  it("1367511/2: fixed capital of 150.000 at 37 %, interest by days", () => {
    const plan = fixedCapitalPlan(9_000_000, 37, 60, "2022-07-02", {
      interestByDays: true,
      startDate: "2022-06-02",
      separateInterest: true,
    });
    const oct = plan.find((p) => p.due_date === "2026-10-02" && p.interest > 0);
    expect(oct?.interest).toBe(41054.79);
    expect(plan[1]?.interest).toBe(273698.63);
  });

  it("1573367/5: French at 29 %, the plan's cuota", () => {
    const plan = frenchPlanWith(35_000_000, 29, 60, "2024-10-04");
    expect(plan[0]?.amount).toBe(1110965.45);
    expect(plan[0]?.interest).toBe(845833.33);
  });
});
