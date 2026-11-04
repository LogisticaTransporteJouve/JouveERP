// Form model of the rendición dialog: per carga, any number of payment lines
// (cash, transfer, a check…), each with its account and amount.

import { parseArAmount, round2 } from "@/lib/format";

import type { DriverSettlementItemInput } from "../schema";

export type LineDraft = {
  key: string;
  account_id: string;
  amount: string;
  reference: string;
  check_number: string;
  bank_name: string;
  check_due_date: string;
};

export type RowDraft = {
  shipment_id: string;
  label: string;
  detail: string;
  expected: number;
  included: boolean;
  note: string;
  lines: LineDraft[];
};

let counter = 0;
function nextKey(): string {
  counter += 1;
  return `line-${counter}`;
}

export function emptyLine(accountId: string, amount = ""): LineDraft {
  return {
    key: nextKey(),
    account_id: accountId,
    amount,
    reference: "",
    check_number: "",
    bank_name: "",
    check_due_date: "",
  };
}

/** A positive es-AR amount ("1.500,50") rounded to cents, or 0 for blank /
 *  invalid / ≤ 0. */
export function parseAmount(raw: string): number {
  const n = parseArAmount(raw) ?? 0;
  return n > 0 ? round2(n) : 0;
}

/** What the driver handed in for one carga (lines with an amount). */
export function rowReceived(row: Pick<RowDraft, "lines">): number {
  return round2(row.lines.reduce((s, l) => s + parseAmount(l.amount), 0));
}

/** The first thing that keeps the rendición from saving, or null. A line
 *  with no amount is ignored (nothing came in on it). */
export function rowsProblem(
  rows: readonly RowDraft[],
  isCheck: (accountId: string) => boolean,
): string | null {
  const included = rows.filter((r) => r.included);
  if (included.length === 0) return "Elegí al menos una carga.";
  for (const r of included) {
    const counted = r.lines.filter((l) => parseAmount(l.amount) > 0);
    if (counted.length > 10) {
      return `Hasta 10 pagos por carga (${r.label}).`;
    }
    for (const l of counted) {
      if (l.account_id === "") return `Elegí la cuenta de ${r.label}.`;
      if (
        isCheck(l.account_id) &&
        (l.check_number.trim() === "" ||
          l.bank_name.trim() === "" ||
          l.check_due_date === "")
      ) {
        return `El cheque de ${r.label} necesita número, banco y fecha de pago.`;
      }
    }
  }
  return null;
}

/** The save payload of the included rows: the lines with an amount, check
 *  fields only on a check account. */
export function rowsToItems(
  rows: readonly RowDraft[],
  isCheck: (accountId: string) => boolean,
): DriverSettlementItemInput[] {
  return rows
    .filter((r) => r.included)
    .map((r) => ({
      shipment_id: r.shipment_id,
      note: r.note,
      lines: r.lines
        .filter((l) => parseAmount(l.amount) > 0)
        .map((l) => {
          const check = isCheck(l.account_id);
          return {
            account_id: l.account_id,
            amount: parseAmount(l.amount),
            reference: l.reference,
            check_number: check ? l.check_number : "",
            bank_name: check ? l.bank_name : "",
            check_due_date: check ? l.check_due_date : "",
          };
        }),
    }));
}
