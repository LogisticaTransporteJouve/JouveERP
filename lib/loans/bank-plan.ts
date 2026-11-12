// A loan's cuotas as the bank lists them, read from text pasted from its home
// banking, or computed with the French system from the TNA. Pure, no DB.

import { addMonthsClamped } from "./amortization";

export type PlanInstallment = {
  number: number;
  due_date: string;
  /** What the bank debits: capital + interest + IVA + perceptions + other. */
  amount: number;
  capital: number;
  interest: number;
  iva: number;
  /** IIBB and other non-IVA perceptions. */
  perception: number;
  iva_perception: number;
  other: number;
  /** The bank lists it as paid. */
  paid: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function arAmount(text: string): number {
  return Number(text.replace(/[$\s.]/g, "").replace(",", "."));
}

function isoDate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

const MONEY = String.raw`\$?\s*-?[\d.]+,\d{2}`;

// Banco Macro's «Plan de cuotas»: Num. de cuota, Vencimiento, Total a pagar,
// Capital, Otro capital, Intereses, Seguro, Otros rubros, IVA, Estado.
const MACRO_ROW = new RegExp(
  String.raw`(?:^|\s)(\d{1,3})\s+(\d{2}/\d{2}/\d{4})` +
    `((?:\\s+${MONEY}){7})` +
    String.raw`\s*(Pagada|Vencida|Vence el\s*\d{2}/\d{2}/\d{4}|Pendiente)?`,
  "gi",
);

/** The cuotas in the pasted text, or an error to show. */
export function parseBankPlan(
  text: string,
): { ok: true; rows: PlanInstallment[] } | { ok: false; error: string } {
  const rows: PlanInstallment[] = [];
  for (const m of text.matchAll(MACRO_ROW)) {
    const amounts = (m[3] ?? "").match(new RegExp(MONEY, "g")) ?? [];
    const [total, capital, otherCapital, interest, insurance, others, iva] =
      amounts.map(arAmount);
    const row: PlanInstallment = {
      number: Number(m[1]),
      due_date: isoDate(m[2] ?? ""),
      amount: round2(total ?? 0),
      capital: round2((capital ?? 0) + (otherCapital ?? 0)),
      interest: round2(interest ?? 0),
      iva: round2(iva ?? 0),
      perception: 0,
      iva_perception: 0,
      other: round2((insurance ?? 0) + (others ?? 0)),
      paid: /^pagada$/i.test((m[4] ?? "").trim()),
    };
    const parts = round2(
      row.capital +
        row.interest +
        row.iva +
        row.perception +
        row.iva_perception +
        row.other,
    );
    if (Math.abs(parts - row.amount) > 0.01) {
      return {
        ok: false,
        error: `En la cuota ${row.number} las partes suman ${parts.toFixed(2)} y el total es ${row.amount.toFixed(2)}.`,
      };
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "No encontramos cuotas. Copiá la tabla «Plan de cuotas» del home banking, con número, vencimiento e importes.",
    };
  }
  rows.sort((a, b) => a.number - b.number);
  if (rows.some((r, i) => r.number !== i + 1)) {
    return {
      ok: false,
      error:
        "Faltan cuotas: copiá la tabla completa, de la primera a la última.",
    };
  }
  return { ok: true, rows };
}

/** French system: the same capital + interest every month, the interest on
 *  the balance at TNA / 12; the last cuota absorbs the rounding. */
export function frenchPlan(
  principal: number,
  tnaPercent: number,
  count: number,
  firstDueDate: string,
): PlanInstallment[] {
  const rate = tnaPercent / 100 / 12;
  const cuota =
    rate === 0
      ? principal / count
      : (principal * rate) / (1 - Math.pow(1 + rate, -count));
  const out: PlanInstallment[] = [];
  let balance = principal;
  for (let n = 1; n <= count; n++) {
    const interest = round2(balance * rate);
    const capital = n === count ? round2(balance) : round2(cuota - interest);
    balance = round2(balance - capital);
    out.push({
      number: n,
      due_date: addMonthsClamped(firstDueDate, n - 1),
      amount: round2(capital + interest),
      capital,
      interest,
      iva: 0,
      perception: 0,
      iva_perception: 0,
      other: 0,
      paid: false,
    });
  }
  return out;
}

export type PlanOptions = {
  /** Interest on the balance × TNA × the days since the previous due date
   *  / 365 (Banco Provincia) instead of TNA / 12. */
  interestByDays?: boolean;
  /** The day the loan was granted: the first period's days start there. */
  startDate?: string | null;
  /** Interest as its own cuota on the same due date (Banco Provincia lists
   *  capital and interest as separate cuotas). */
  separateInterest?: boolean;
  /** The first cuotas, already paid when the loan is loaded. */
  paidCount?: number;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Fixed capital (German system): the same capital every month and the
 *  interest on what is still owed. */
export function fixedCapitalPlan(
  principal: number,
  tnaPercent: number,
  count: number,
  firstDueDate: string,
  options: PlanOptions = {},
): PlanInstallment[] {
  const capitalEach = round2(principal / count);
  const rows: Omit<PlanInstallment, "number" | "paid">[] = [];
  let balance = principal;
  let previous = options.startDate ?? addMonthsClamped(firstDueDate, -1);
  for (let n = 1; n <= count; n++) {
    const due = addMonthsClamped(firstDueDate, n - 1);
    const interest = options.interestByDays
      ? round2(
          ((balance * tnaPercent) / 100) * (daysBetween(previous, due) / 365),
        )
      : round2((balance * tnaPercent) / 100 / 12);
    const capital = n === count ? round2(balance) : capitalEach;
    balance = round2(balance - capital);
    previous = due;
    const parts = { iva: 0, perception: 0, iva_perception: 0, other: 0 };
    if (options.separateInterest) {
      rows.push({
        due_date: due,
        amount: capital,
        capital,
        interest: 0,
        ...parts,
      });
      rows.push({
        due_date: due,
        amount: interest,
        capital: 0,
        interest,
        ...parts,
      });
    } else {
      rows.push({
        due_date: due,
        amount: round2(capital + interest),
        capital,
        interest,
        ...parts,
      });
    }
  }
  return numbered(rows, options.paidCount ?? 0);
}

/** French system with options: interest by days, cuotas already paid. The
 *  capital follows the plan at TNA / 12, as the banks print it. */
export function frenchPlanWith(
  principal: number,
  tnaPercent: number,
  count: number,
  firstDueDate: string,
  options: PlanOptions = {},
): PlanInstallment[] {
  const base = frenchPlan(principal, tnaPercent, count, firstDueDate);
  let balance = principal;
  let previous = options.startDate ?? addMonthsClamped(firstDueDate, -1);
  const rows = base.map((p) => {
    const interest = options.interestByDays
      ? round2(
          ((balance * tnaPercent) / 100) *
            (daysBetween(previous, p.due_date) / 365),
        )
      : p.interest;
    balance = round2(balance - p.capital);
    previous = p.due_date;
    return { ...p, interest, amount: round2(p.capital + interest) };
  });
  return numbered(rows, options.paidCount ?? 0);
}

function numbered(
  rows: readonly Omit<PlanInstallment, "number" | "paid">[],
  paidCount: number,
): PlanInstallment[] {
  return rows
    .filter((r) => r.amount > 0)
    .map((r, i) => ({ ...r, number: i + 1, paid: i < paidCount }));
}

/** Puts first the cuotas the bank numbers at the grant (Banco Provincia:
 *  cuota 1 is the taxes of the grant, cuota 2 is $0, both on the day it was
 *  granted), so the numbers match the bank's. Then marks paid the first
 *  `paidCount` of all of them, counted as the bank counts. */
export function withOpeningCuotas(
  plan: readonly PlanInstallment[],
  opening: { count: number; date: string; taxes: number },
  paidCount: number,
): PlanInstallment[] {
  const leading: PlanInstallment[] = Array.from(
    { length: Math.max(0, opening.count) },
    (_, i) => {
      const taxes = i === 0 ? round2(opening.taxes) : 0;
      return {
        number: 0,
        due_date: opening.date,
        amount: taxes,
        capital: 0,
        interest: 0,
        iva: 0,
        perception: 0,
        iva_perception: 0,
        other: taxes,
        paid: true,
      };
    },
  );
  return [...leading, ...plan].map((p, i) => ({
    ...p,
    number: i + 1,
    paid: p.paid || i < paidCount,
  }));
}
