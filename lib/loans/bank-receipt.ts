// Banco Macro's «Comprobante de pago de préstamo», read from the PDF's text:
// the loan it pays, the cuota and what it applied. Pure, no DB.

export type BankLoanReceipt = {
  /** «Número de operación»: the loan's number at the bank. */
  loan_number: string;
  receipt_number: string;
  paid_date: string;
  installment_number: number;
  total: number;
  capital: number;
  interest: number;
  /** Punitorios and compensatorios. */
  late_interest: number;
  /** IVA on the interest, punitorios and compensatorios. */
  iva: number;
  iva_perception: number;
  iibb_perception: number;
};

type Part = Exclude<
  keyof BankLoanReceipt,
  | "loan_number"
  | "receipt_number"
  | "paid_date"
  | "installment_number"
  | "total"
>;

/** Where each concept the bank applies goes. */
function partOf(concept: string): Part | null {
  const c = concept.replace(/\s+/g, " ").trim().toUpperCase();
  if (c === "CAPITAL" || c === "OTRO CAPITAL") return "capital";
  if (c === "INTERES" || c === "INTERESES") return "interest";
  if (c === "PUNITORIOS" || c === "COMPENSATORIOS") return "late_interest";
  if (c === "IVA PERCEPCION") return "iva_perception";
  if (c.startsWith("IVA ")) return "iva";
  if (c.startsWith("PER.ING.BR")) return "iibb_perception";
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const arAmount = (s: string) =>
  Number(s.replace(/[$\s.]/g, "").replace(",", "."));

function valueAfter(lines: string[], label: string): string | null {
  const i = lines.indexOf(label);
  return i >= 0 ? (lines[i + 1] ?? null) : null;
}

const CONCEPT = new RegExp(
  String.raw`(?:^|\n)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ. ]*[A-ZÁÉÍÓÚÑ.])\n(\d{1,3})\n[\d,.]+\n[\d,.]+\n[\d,.]+\n(\$ ?-?[\d.]+,\d{2})`,
  "g",
);

const partsTotal = (r: BankLoanReceipt) =>
  round2(
    r.capital +
      r.interest +
      r.late_interest +
      r.iva +
      r.iva_perception +
      r.iibb_perception,
  );

/** The receipt in the text, or why it is not one. A debit that pays the end
 *  of one cuota and the start of the next comes back as one part per cuota
 *  (number «comprobante-cuota»), each with its own total. */
export function parseBankLoanReceipt(
  text: string,
): { ok: true; receipts: BankLoanReceipt[] } | { ok: false; error: string } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (!lines.includes("Comprobante de pago de préstamo")) {
    return { ok: false, error: "No es un comprobante de pago de préstamo." };
  }
  const loan = valueAfter(lines, "Número de operación");
  const receipt = valueAfter(lines, "Número de comprobante");
  const date = valueAfter(lines, "Fecha");
  const total = valueAfter(lines, "Monto");
  if (
    !loan ||
    !receipt ||
    !date ||
    !/^\d{2}\/\d{2}\/\d{4}$/.test(date) ||
    !total
  ) {
    return { ok: false, error: "Faltan la fecha, los números o el monto." };
  }
  const [d, m, y] = date.split("/");
  const byCuota = new Map<number, BankLoanReceipt>();
  for (const match of lines.join("\n").matchAll(CONCEPT)) {
    const part = partOf(match[1] ?? "");
    if (!part) {
      return { ok: false, error: `Concepto que no reconocemos: ${match[1]}.` };
    }
    const cuota = Number(match[2]);
    const r = byCuota.get(cuota) ?? {
      loan_number: loan,
      receipt_number: receipt,
      paid_date: `${y}-${m}-${d}`,
      installment_number: cuota,
      total: 0,
      capital: 0,
      interest: 0,
      late_interest: 0,
      iva: 0,
      iva_perception: 0,
      iibb_perception: 0,
    };
    r[part] = round2(r[part] + arAmount(match[3] ?? "0"));
    byCuota.set(cuota, r);
  }
  if (byCuota.size === 0) {
    return {
      ok: false,
      error: "El comprobante no trae los conceptos aplicados.",
    };
  }
  const receipts = [...byCuota.values()]
    .sort((a, b) => a.installment_number - b.installment_number)
    .map((r) => ({
      ...r,
      total: partsTotal(r),
      receipt_number:
        byCuota.size > 1 ? `${receipt}-${r.installment_number}` : receipt,
    }));
  const parts = round2(receipts.reduce((s, r) => s + r.total, 0));
  const amount = round2(arAmount(total));
  if (Math.abs(parts - amount) > 0.005) {
    return {
      ok: false,
      error: `Los conceptos suman ${parts.toFixed(2)} y el monto es ${amount.toFixed(2)}.`,
    };
  }
  return { ok: true, receipts };
}
