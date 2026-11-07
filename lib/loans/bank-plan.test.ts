import { describe, expect, it } from "vitest";

import { frenchPlan, parseBankPlan } from "./bank-plan";

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
