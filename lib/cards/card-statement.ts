// A credit card statement (Banco Galicia's «Resumen de tarjeta de crédito
// VISA BUSINESS»), read from the visual lines of its PDF. Pure, no DB.

export type CardCurrency = "ARS" | "USD";

export type CardPurchase = {
  date: string;
  description: string;
  /** «07/09»: cuota 7 of 9; null for a single payment. */
  installment: string | null;
  voucher: string | null;
  amount: number;
  currency: CardCurrency;
};

export type CardSection = {
  last4: string;
  holder: string;
  total_ars: number;
  total_usd: number;
  purchases: CardPurchase[];
};

/** What the bank charges on the statement itself. */
export type CardChargeKind =
  | "stamp_tax"
  | "fee"
  | "iva"
  | "iibb_perception"
  | "iva_perception"
  | "income_tax_perception"
  | "interest"
  | "other";

export type CardCharge = {
  date: string;
  description: string;
  kind: CardChargeKind;
  amount: number;
};

export type CardStatement = {
  number: string;
  account_number: string | null;
  close_date: string;
  due_date: string;
  total_ars: number;
  total_usd: number;
  previous_ars: number;
  previous_usd: number;
  cards: CardSection[];
  charges: CardCharge[];
};

const AMOUNT = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const LINE_DATE = /^(\d{2})-(\d{2})-(\d{2})\s+(.*)$/;
const MONTHS: Record<string, string> = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dic: "12",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const shortDate = (d: string, m: string, y: string) => `20${y}-${m}-${d}`;

function chargeKind(description: string): CardChargeKind {
  const d = description.toUpperCase();
  if (d.includes("SELLOS")) return "stamp_tax";
  if (d.startsWith("PERCEP.IVA") || d.includes("PERCEPCION IVA")) {
    return "iva_perception";
  }
  if (d.includes("IVA")) return "iva";
  if (d.includes("ING.BRUTOS") || d.includes("IIBB")) return "iibb_perception";
  if (
    d.includes("RG 5617") ||
    d.includes("RG 4815") ||
    d.includes("GANANCIAS")
  ) {
    return "income_tax_perception";
  }
  if (d.includes("COMISI")) return "fee";
  if (d.includes("INTERES")) return "interest";
  return "other";
}

/** The statement, or why the text is not one. */
export function parseCardStatement(
  lines: readonly string[],
): { ok: true; statement: CardStatement } | { ok: false; error: string } {
  const rows = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const number = rows
    .map((r) => /^Resumen N° (\S+)/.exec(r)?.[1])
    .find(Boolean);
  if (!number || !rows.some((r) => /^DETALLE DEL CONSUMO/i.test(r))) {
    return { ok: false, error: "No es un resumen de tarjeta de crédito." };
  }
  const account =
    rows.map((r) => /N° Cuenta: (\d+)/.exec(r)?.[1]).find(Boolean) ?? null;

  // «01-Oct-26 13-Oct-26 29-Oct-26 11-Nov-26 …»: previous close and due,
  // this close and due, next close and due.
  const dates = rows
    .map((r) => [...r.matchAll(/(\d{2})-([A-Za-z]{3})-(\d{2})/g)])
    .find((m) => m.length >= 4);
  const iso = (m: RegExpMatchArray | undefined) => {
    const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
    return m && month ? shortDate(m[1]!, month, m[3]!) : null;
  };
  const closeDate = iso(dates?.[2]);
  const dueDate = iso(dates?.[3]);

  const totalAt = rows.findIndex((r) => /^TOTAL A PAGAR$/i.test(r));
  const totals =
    totalAt > 0
      ? rows[totalAt - 1]!.split(" ").filter((t) => AMOUNT.test(t))
      : [];
  const previous =
    rows
      .find((r) => /^SALDO ANTERIOR /i.test(r))
      ?.split(" ")
      .filter((t) => AMOUNT.test(t)) ?? [];
  if (!closeDate || !dueDate || totals.length < 1) {
    return {
      ok: false,
      error: "No se pudieron leer las fechas o el total a pagar.",
    };
  }

  const cards: CardSection[] = [];
  const charges: CardCharge[] = [];
  let pending: CardPurchase[] = [];
  let afterCards = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const total =
      /^TARJETA (\d{4}) Total Consumos de (.+?) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2})$/.exec(
        row,
      );
    if (total) {
      // A statement prints the same card's footer again at the top of the
      // next page: count it once.
      if (!cards.some((c) => c.last4 === total[1] && pending.length === 0)) {
        cards.push({
          last4: total[1]!,
          holder: total[2]!,
          total_ars: money(total[3]!),
          total_usd: money(total[4]!),
          purchases: pending,
        });
      }
      pending = [];
      afterCards = true;
      continue;
    }
    const dated = LINE_DATE.exec(row);
    if (!dated) continue;
    const [, d, m, y, rest] = dated;
    if (/^SU PAGO/i.test(rest!)) continue;
    const tokens = rest!.split(" ");
    const last = tokens[tokens.length - 1] ?? "";
    if (!AMOUNT.test(last)) continue;
    const date = shortDate(d!, m!, y!);

    // A purchase starts with its type («*», «K», «F»); a charge of the
    // statement has none and comes after the last card.
    if (/^[*A-Z]$/.test(tokens[0]!) && tokens.length > 2) {
      const body = tokens.slice(1, -1);
      const usd = body.includes("USD") || /USD/.test(body.join(" "));
      let installment: string | null = null;
      let voucher: string | null = null;
      const words: string[] = [];
      for (const t of body) {
        if (!installment && /^\d{2}\/\d{2}$/.test(t)) installment = t;
        else words.push(t);
      }
      if (words.length > 1 && /^\d{6}$/.test(words[words.length - 1]!)) {
        voucher = words.pop()!;
      } else if (/^\d{6}$/.test(rows[i + 1] ?? "")) {
        voucher = rows[i + 1]!;
      }
      if (usd) {
        // «Spotify PUSD 2,98 499821 2,98»: drop the amount repeated in the text.
        while (
          words.length &&
          (AMOUNT.test(words[words.length - 1]!) ||
            /^\d{6}$/.test(words[words.length - 1]!))
        ) {
          const w = words.pop()!;
          if (!voucher && /^\d{6}$/.test(w)) voucher = w;
        }
      }
      pending.push({
        date,
        description: words
          .join(" ")
          .replace(/\s*PUSD$/, "")
          .trim(),
        installment,
        voucher,
        amount: money(last),
        currency: usd ? "USD" : "ARS",
      });
      continue;
    }
    if (afterCards) {
      const description = tokens.slice(0, -1).join(" ");
      charges.push({
        date,
        description,
        kind: chargeKind(description),
        amount: money(last),
      });
    }
  }

  if (cards.length === 0) {
    return { ok: false, error: "El resumen no trae consumos por tarjeta." };
  }
  for (const c of cards) {
    const ars = round2(
      c.purchases
        .filter((p) => p.currency === "ARS")
        .reduce((s, p) => s + p.amount, 0),
    );
    const usd = round2(
      c.purchases
        .filter((p) => p.currency === "USD")
        .reduce((s, p) => s + p.amount, 0),
    );
    if (ars !== c.total_ars || usd !== c.total_usd) {
      return {
        ok: false,
        error: `Los consumos leídos de la tarjeta ${c.last4} no suman su total (${ars} / ${c.total_ars}): revisalo a mano.`,
      };
    }
  }
  const totalArs = money(totals[0]!);
  const sum = round2(
    cards.reduce((s, c) => s + c.total_ars, 0) +
      charges.reduce((s, c) => s + c.amount, 0),
  );
  if (sum !== totalArs) {
    return {
      ok: false,
      error: `Los consumos y cargos leídos suman ${sum} y el resumen dice ${totalArs}: revisalo a mano.`,
    };
  }
  return {
    ok: true,
    statement: {
      number,
      account_number: account,
      close_date: closeDate,
      due_date: dueDate,
      total_ars: totalArs,
      total_usd: totals[1] ? money(totals[1]) : 0,
      previous_ars: previous[0] ? money(previous[0]) : 0,
      previous_usd: previous[1] ? money(previous[1]) : 0,
      cards,
      charges,
    },
  };
}
