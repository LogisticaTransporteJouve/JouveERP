// Mercedes-Benz Compañía Financiera's «Resumen de cuenta» of a leasing, read
// from the PDF's text: the cuota it bills (capital, interest, their IVA and
// each charge with its IVA) plus what is overdue (sections (2) and (3)).
// Pure, no DB. Amounts come as 2,190,131.30.

export const LEASING_CHARGE_CONCEPTS = [
  "seguro",
  "patentes",
  "mora",
  "valor_residual",
  "otro",
] as const;
export type LeasingChargeConcept = (typeof LEASING_CHARGE_CONCEPTS)[number];

export type LeasingCharge = {
  concept: LeasingChargeConcept;
  description: string;
  /** Without IVA. */
  amount: number;
  iva_amount: number;
};

export type LeasingStatement = {
  /** «Operación»: the contract number. */
  operation: string | null;
  installment_number: number;
  due_date: string;
  capital: number;
  interest: number;
  /** IVA on the capital and the interest. */
  iva: number;
  charges: LeasingCharge[];
  /** What the cuota comes to: Σ of the above. */
  total: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const AMOUNT = /^\$?\s*-?[\d,]+\.\d{2}$/;
const amountOf = (s: string) => Number(s.replace(/[$\s,]/g, ""));
const isAmount = (s: string | undefined): s is string =>
  s !== undefined && AMOUNT.test(s);

type Row = {
  concept: string;
  cuota: number;
  due: string;
  amount: number;
  iva: number;
};

function isoDate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

/** The rows of «CUOTA ACTUAL (1)» and its three totals (amount, IVA, total). */
function currentCuota(
  lines: string[],
): { rows: Row[]; totals: [number, number, number] } | null {
  const start = lines.indexOf("CUOTA ACTUAL (1)");
  if (start < 0) return null;
  let k = lines.indexOf("IVA", start);
  if (k < 0) return null;
  k += 1;
  const rows: Row[] = [];
  while (
    k + 4 < lines.length &&
    /^\d{1,3}$/.test(lines[k + 1] ?? "") &&
    /^\d{2}\/\d{2}\/\d{4}$/.test(lines[k + 2] ?? "") &&
    isAmount(lines[k + 3]) &&
    isAmount(lines[k + 4])
  ) {
    rows.push({
      concept: lines[k] ?? "",
      cuota: Number(lines[k + 1]),
      due: isoDate(lines[k + 2] ?? ""),
      amount: amountOf(lines[k + 3] ?? "0"),
      iva: amountOf(lines[k + 4] ?? "0"),
    });
    k += 5;
  }
  const [a, b, c] = [lines[k], lines[k + 1], lines[k + 2]];
  if (!isAmount(a) || !isAmount(b) || !isAmount(c)) return null;
  return { rows, totals: [amountOf(a), amountOf(b), amountOf(c)] };
}

/** The amount printed right before a section's total label. */
function sectionTotal(lines: string[], label: string): number | null {
  const i = lines.indexOf(label);
  if (i < 1) return null;
  const v = lines[i - 1];
  return isAmount(v) ? amountOf(v) : null;
}

function chargeConcept(concept: string): LeasingChargeConcept {
  const c = concept.toLowerCase();
  if (c.includes("seguro")) return "seguro";
  if (c.includes("patente")) return "patentes";
  if (
    c.includes("residual") ||
    c.includes("opción de compra") ||
    c.includes("opcion de compra")
  )
    return "valor_residual";
  if (c.includes("punit") || c.includes("mora") || c.includes("compensat"))
    return "mora";
  return "otro";
}

const IVA_ROW = /^i\.?\s?v\.?\s?a\.?\b/i;

/** The statement in the text, or why it is not one. */
export function parseLeasingStatement(
  text: string,
): { ok: true; statement: LeasingStatement } | { ok: false; error: string } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const lender = lines.findIndex((l) =>
    /^Mercedes[ -]Benz Compañía Financiera/i.test(l),
  );
  if (lender < 0 || !lines.includes("CUOTA ACTUAL (1)")) {
    return {
      ok: false,
      error: "No es un resumen de cuota de Mercedes-Benz Compañía Financiera.",
    };
  }
  const operation = /^\d{3,12}$/.test(lines[lender + 1] ?? "")
    ? (lines[lender + 1] ?? null)
    : null;

  const cuota = currentCuota(lines);
  if (!cuota || cuota.rows.length === 0) {
    return { ok: false, error: "El resumen no trae la cuota actual." };
  }
  const numbers = new Set(cuota.rows.map((r) => r.cuota));
  if (numbers.size !== 1) {
    return {
      ok: false,
      error: "El resumen trae conceptos de más de una cuota.",
    };
  }

  let capital = 0;
  let interest = 0;
  let iva = 0;
  const charges: LeasingCharge[] = [];
  for (const r of cuota.rows) {
    const c = r.concept.toLowerCase();
    if (IVA_ROW.test(r.concept)) {
      // A separate IVA row goes with the charge it names, else with the canon.
      const kind = chargeConcept(r.concept);
      const target =
        kind === "otro" ? undefined : charges.find((ch) => ch.concept === kind);
      if (target) {
        target.iva_amount = round2(target.iva_amount + r.amount + r.iva);
      } else {
        iva = round2(iva + r.amount + r.iva);
      }
    } else if (c.includes("capital")) {
      capital = round2(capital + r.amount);
      iva = round2(iva + r.iva);
    } else if (c.includes("interes") || c.includes("interés")) {
      interest = round2(interest + r.amount);
      iva = round2(iva + r.iva);
    } else {
      charges.push({
        concept: chargeConcept(r.concept),
        description: r.concept,
        amount: r.amount,
        iva_amount: r.iva,
      });
    }
  }

  const [sumAmount, sumIva, total] = cuota.totals;
  const rowsAmount = round2(cuota.rows.reduce((s, r) => s + r.amount, 0));
  const rowsIva = round2(cuota.rows.reduce((s, r) => s + r.iva, 0));
  if (
    Math.abs(rowsAmount - sumAmount) > 0.005 ||
    Math.abs(rowsIva - sumIva) > 0.005 ||
    Math.abs(round2(sumAmount + sumIva) - total) > 0.005
  ) {
    return {
      ok: false,
      error: `Los conceptos de la cuota suman ${round2(rowsAmount + rowsIva).toFixed(2)} y el total es ${total.toFixed(2)}.`,
    };
  }

  // What is overdue is billed with the cuota: (2) deuda anterior and (3)
  // intereses compensatorios y punitorios, as mora.
  const previous = sectionTotal(lines, "Total Deuda Anterior") ?? 0;
  const late = sectionTotal(lines, "Total Int. Comp. y Punit.") ?? 0;
  if (previous > 0) {
    charges.push({
      concept: "mora",
      description: "Deuda anterior",
      amount: previous,
      iva_amount: 0,
    });
  }
  if (late > 0) {
    charges.push({
      concept: "mora",
      description: "Intereses compensatorios y punitorios",
      amount: late,
      iva_amount: 0,
    });
  }

  const first = cuota.rows[0];
  return {
    ok: true,
    statement: {
      operation,
      installment_number: first?.cuota ?? 0,
      due_date: first?.due ?? "",
      capital,
      interest,
      iva,
      charges,
      total: round2(total + previous + late),
    },
  };
}
