/** A bank statement read from the rows of its PDF (see readPdfLines). Each
 *  bank lays it out its own way: signed or unsigned amounts, debit and credit
 *  in separate columns, two- or four-digit years, a decimal comma or point,
 *  newest or oldest first. What they share is a movement per row that starts
 *  with its date and ends with the amount and the balance after it, so the
 *  sign and the order come from the balances, not from the layout. */

export type PdfStatementRow = {
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  bankCode: string | null;
  amount: number;
  balance: number;
};

const DATE = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/;
// An amount always has two decimals: "1.234,56", "1234.56", "$ -12,00",
// "+ $ 50.465,17", "-478.576,83", Galicia's negative balance
// "1.429.309,83-". A value date like "02-10" is not one.
const AMOUNT =
  /([+-])?\s*\$?\s*(-)?\s*(\d{1,3}(?:[.,]\d{3})*|\d+)([.,])(\d{2})(?!\d)(-)?/g;
const OPENING = /saldo (ultimo extracto|anterior|inicial)/i;

const cents = (n: number) => Math.round(n * 100);

function toIsoDate(d: string, m: string, y: string): string {
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m}-${d}`;
}

function amountsIn(
  text: string,
): { value: number; signed: boolean; index: number }[] {
  const out: { value: number; signed: boolean; index: number }[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const whole = m[3]!.replace(/[.,]/g, "");
    const value = Number(`${whole}.${m[5]}`);
    const negative = m[1] === "-" || m[2] === "-" || m[6] === "-";
    out.push({
      value: negative ? -value : value,
      signed: m[1] !== undefined || m[2] !== undefined || m[6] !== undefined,
      index: m.index ?? 0,
    });
  }
  return out;
}

const plain = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Parsed = Omit<PdfStatementRow, "amount"> & {
  abs: number;
  sign: 1 | -1 | null;
};

export function statementRowsFromPdfLines(
  lines: readonly string[],
): { rows: PdfStatementRow[] } | { error: string } {
  // Macro's "Últimos movimientos" puts the reference and its causal code
  // (the bank code) before the concept.
  const withCausal = lines.some((l) => /\bcausal\b/i.test(plain(l)));
  let opening: number | null = null;
  const parsed: Parsed[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const date = DATE.exec(line);
    if (!date) {
      if (OPENING.test(plain(line))) {
        const values = amountsIn(line);
        if (values.length > 0 && parsed.length === 0) {
          opening = values[values.length - 1]!.value;
        }
      }
      continue;
    }
    const rest = line.slice(date[0].length);
    const values = amountsIn(rest);
    if (OPENING.test(plain(rest))) {
      if (values.length > 0 && parsed.length === 0) {
        opening = values[values.length - 1]!.value;
      }
      continue;
    }
    if (values.length < 2) continue;
    // Galicia lists a deposit not yet credited ("EN PROCESO"); its xlsx
    // marks it «Pendiente» and the import leaves it out until it is.
    if (/\ben proceso\b/.test(plain(rest))) continue;
    const balance = values[values.length - 1]!;
    const amount = values[values.length - 2]!;
    let text = rest.slice(0, amount.index).trim();
    let reference: string | null = null;
    let bankCode: string | null = null;
    if (withCausal) {
      const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(text);
      if (m) {
        reference = m[1]!;
        bankCode = m[2]!;
        text = m[3]!;
      }
    }
    parsed.push({
      date: toIsoDate(date[1]!, date[2]!, date[3]!),
      description: text.replace(/\s+/g, " "),
      reference,
      bankCode,
      abs: Math.abs(amount.value),
      sign: amount.signed ? (amount.value < 0 ? -1 : 1) : null,
      balance: balance.value,
    });
  }
  if (parsed.length === 0) {
    return { error: "No encontramos movimientos en el PDF." };
  }

  const fits = (delta: number, abs: number) =>
    Math.abs(cents(Math.abs(delta)) - cents(abs)) <= 1;
  const ascending = parsed.every(
    (r, i) => i === 0 || fits(r.balance - parsed[i - 1]!.balance, r.abs),
  );
  const descending = parsed.every(
    (r, i) =>
      i === parsed.length - 1 ||
      fits(r.balance - parsed[i + 1]!.balance, r.abs),
  );

  // A file that signs its amounts leaves a credit unsigned ("$ 334.506,56"
  // next to "$ -2.007,04").
  const signsAmounts = parsed.some((r) => r.sign === -1);
  const signOf = (r: Parsed) => r.sign ?? (signsAmounts ? 1 : null);
  const signedFrom = (r: Parsed, previous: number | null): number | null => {
    if (previous !== null && fits(r.balance - previous, r.abs)) {
      return (cents(r.balance) - cents(previous)) / 100;
    }
    const sign = signOf(r);
    return sign === null ? null : sign * r.abs;
  };

  const rows: PdfStatementRow[] = [];
  if (ascending || descending) {
    const order = ascending ? parsed : [...parsed].reverse();
    let previous = opening;
    for (const r of order) {
      const amount = signedFrom(r, previous);
      if (amount === null) {
        return {
          error:
            "No se puede saber si el primer movimiento del PDF es débito o crédito: falta el saldo anterior.",
        };
      }
      rows.push({ ...strip(r), amount });
      previous = r.balance;
    }
    return { rows: ascending ? rows : rows.reverse() };
  }
  if (parsed.every((r) => signOf(r) !== null)) {
    return {
      rows: parsed.map((r) => ({ ...strip(r), amount: signOf(r)! * r.abs })),
    };
  }
  return {
    error:
      "Los saldos del PDF no encadenan con los importes: no se puede leer como extracto.",
  };
}

function strip(r: Parsed): Omit<PdfStatementRow, "amount"> {
  return {
    date: r.date,
    description: r.description,
    reference: r.reference,
    bankCode: r.bankCode,
    balance: r.balance,
  };
}

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** The rows as the CSV the statement import already reads. */
export function statementRowsToCsv(rows: readonly PdfStatementRow[]): string {
  const head = [
    "Fecha",
    "Descripción",
    "Referencia",
    "Causal",
    "Importe",
    "Saldo",
  ];
  const body = rows.map((r) =>
    [
      r.date,
      csvCell(r.description),
      r.reference ?? "",
      r.bankCode ?? "",
      r.amount.toFixed(2),
      r.balance.toFixed(2),
    ].join(","),
  );
  return [head.join(","), ...body].join("\n");
}
