// A bank's cheque discount receipt («Comprobante final» of Banco Galicia's
// «Descuento de cheques»), read from the text of its PDF. Pure, no DB.

export type DiscountReceiptCheque = {
  /** The bank's number for the part of the operation this cheque is in:
   *  the statement credits one line per number. */
  loan_number: string;
  check_number: string;
  drawer_cuit: string;
  due_date: string;
  amount: number;
};

export type DiscountReceipt = {
  /** The bank that bought the cheques, when the receipt names it. */
  buyer: { name: string; cuit: string } | null;
  operation: string;
  date: string;
  cheques: DiscountReceiptCheque[];
  gross: number;
  interest: number;
  iva: number;
  iva_perception: number;
  stamp_tax: number;
  iibb: number;
  net: number;
};

const MONEY = /^\$\s*-?[\d.]+,\d{2}$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const CUIT = /^\d{2}-\d{8}-\d$/;

function money(token: string): number {
  return Number(token.replace(/[$\s.]/g, "").replace(",", "."));
}

function isoDate(token: string): string | null {
  const m = DATE.exec(token);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The receipt, or why the text is not one. */
export function parseDiscountReceipt(
  text: string,
): { ok: true; receipt: DiscountReceipt } | { ok: false; error: string } {
  const tokens = text
    .split(/\r?\n/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t !== "");
  const at = (label: string) =>
    tokens.findIndex((t) => t.toLowerCase() === label.toLowerCase());

  const head = at("Fecha ejecutada");
  const totals = at("Cheques y descuentos");
  const detail = at("Detalle de los cheques");
  if (head < 0 || totals < 0 || detail < 0) {
    return {
      ok: false,
      error:
        "No es un comprobante de descuento de cheques (falta el detalle de la operación o de los cheques).",
    };
  }

  const operation = tokens
    .slice(head + 1, totals)
    .find((t) => /^\d{6,}$/.test(t));
  const date = tokens
    .slice(head + 1, totals)
    .map(isoDate)
    .find((d) => d !== null);
  // Total de cheques, Interés, IVA, IVA Percepción, Sellos, Ingresos Brutos
  // and Total con descuentos, in this order.
  const amounts = tokens
    .slice(totals, detail)
    .filter((t) => MONEY.test(t))
    .map(money);
  if (!operation || !date || amounts.length !== 7) {
    return {
      ok: false,
      error: "No se pudieron leer la operación, la fecha o los totales.",
    };
  }
  const [gross, interest, iva, ivaPerception, stampTax, iibb, net] =
    amounts as [number, number, number, number, number, number, number];

  const cheques: DiscountReceiptCheque[] = [];
  const body = tokens.slice(detail + 1);
  for (let i = 0; i < body.length; i++) {
    const loan = body[i]!;
    if (!/^\d{10,14}$/.test(loan)) continue;
    const checkNumber = body[i + 1];
    const cuit = body[i + 2];
    const due = isoDate(body[i + 3] ?? "");
    const amountAt = body.slice(i + 4, i + 10).findIndex((t) => MONEY.test(t));
    if (!checkNumber || !cuit || !CUIT.test(cuit) || !due || amountAt < 0)
      continue;
    cheques.push({
      loan_number: loan,
      check_number: checkNumber.replace(/^0+(?=\d)/, ""),
      drawer_cuit: cuit.replace(/-/g, ""),
      due_date: due,
      amount: money(body[i + 4 + amountAt]!),
    });
    i += 4 + amountAt;
  }
  if (cheques.length === 0) {
    return { ok: false, error: "El comprobante no trae cheques." };
  }
  const sum = round2(cheques.reduce((s, c) => s + c.amount, 0));
  if (sum !== round2(gross)) {
    return {
      ok: false,
      error: `Los cheques leídos suman ${sum} y el comprobante dice ${gross}: revisalo a mano.`,
    };
  }
  return {
    ok: true,
    receipt: {
      buyer: /banco de galicia/i.test(text)
        ? { name: "Banco Galicia", cuit: "30500001735" }
        : null,
      operation,
      date,
      cheques,
      gross,
      interest,
      iva,
      iva_perception: ivaPerception,
      stamp_tax: stampTax,
      iibb,
      net,
    },
  };
}
