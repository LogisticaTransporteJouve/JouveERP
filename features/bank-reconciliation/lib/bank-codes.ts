import { isValidCuit } from "@/lib/validation/cuit";

import type {
  BankCodeKind,
  BankCodePreset,
  StatementCardStatement,
  StatementCheckSaleTransfer,
  BankStatementCode,
  StatementClient,
  StatementLine,
  StatementLoanInstallment,
} from "../schema";

function norm(text: string): string {
  return text.toUpperCase().replace(/\s+/g, " ").trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a normalized description has the pattern as whole words: «IVA»
 *  is Galicia's IVA line, not the «IVA» inside «RIVADAVIA». */
function hasWords(description: string, pattern: string): boolean {
  return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(pattern)}($|[^A-Z0-9])`).test(
    description,
  );
}

/** The code that says what a line is. Among the codes of its bank code,
 *  the one whose text the description contains (the longest wins), else the
 *  one for the whole code. A bank whose statement has no code (Provincia)
 *  is read by text alone: the code with no bank code whose text the
 *  description contains, the longest first. */
export function findBankCode(
  line: Pick<StatementLine, "bank_code" | "description">,
  codes: readonly BankStatementCode[],
): BankStatementCode | null {
  const description = norm(line.description);
  const longest = (candidates: readonly BankStatementCode[]) => {
    let best: BankStatementCode | null = null;
    for (const c of candidates) {
      const pattern = norm(c.description_pattern);
      if (pattern !== "" && !hasWords(description, pattern)) continue;
      if (!best || pattern.length > norm(best.description_pattern).length) {
        best = c;
      }
    }
    return best;
  };
  const byCode = line.bank_code
    ? longest(codes.filter((c) => c.bank_code === line.bank_code))
    : null;
  return (
    byCode ??
    longest(
      codes.filter((c) => c.bank_code === "" && c.description_pattern !== ""),
    )
  );
}

/** The fixed start of a description, to offer as a code's text: what comes
 *  before a CUIT, a parenthesis, an amount or a branch («TRANSF DE VALDEZ,
 *  MONICA (2320…)» → «TRANSF DE VALDEZ, MONICA»). The user trims it. */
export function conceptOf(description: string): string {
  const start = description.split(/\s{2,}|\(|\d{4,}/)[0] ?? "";
  return norm(start)
    .replace(/[\s,.:-]+$/, "")
    .slice(0, 80);
}

/** The valid CUITs written in a line's description (Macro puts the
 *  counterparty's at the end: "TEF DATANET PR LIMPART SRL 30601677675"). */
export function cuitsIn(description: string): string[] {
  const found = description.match(/\d{11}/g) ?? [];
  return [...new Set(found)].filter((c) => isValidCuit(c));
}

/** Who sent a transfer, as the line says it: the first valid CUIT and the
 *  name around it («TRANSF DE ANDINO OUTFITTERS SO (33718235559) VAR» →
 *  «ANDINO OUTFITTERS SO»; «CR.TRAN. 30708978554 ELECTRA MERCEDES» →
 *  «ELECTRA MERCEDES»). Null when the line names no one. */
export function counterpartyOf(
  description: string,
): { cuit: string | null; name: string } | null {
  const cuit = cuitsIn(description)[0] ?? null;
  const name = norm(
    description
      .replace(/^\s*(TRANSF(ERENCIA)? DE|CR\.?\s*TRAN\.?|TEF)\s+/i, "")
      .replace(/\(.*$/, "")
      .replace(/\d{11}/g, " "),
  )
    .replace(/[\s,.:-]+$/, "")
    .slice(0, 120);
  if (!cuit && name === "") return null;
  return { cuit, name };
}

export type LineProposal = {
  kind: BankCodeKind | null;
  code: BankStatementCode | null;
  /** What the line is, for the user. */
  label: string;
  /** The client of a collection, found by the CUIT in the description. */
  client: StatementClient | null;
  /** The loan cuota a loan debit pays: same amount, the closest due date. */
  installment: StatementLoanInstallment | null;
  /** The transfers of a cheque sale a discount credit is: the cheques of
   *  one «N° de préstamo», summing the line. */
  sale_transfers?: StatementCheckSaleTransfer[];
  /** The card statement (and which part) a card payment debit pays. */
  card?: { statement: StatementCardStatement; currency: "ARS" | "USD" };
  /** Can be accepted in one click: a tax or fee with its account. */
  ready: boolean;
  /** What is missing to book it, when something is. */
  missing: string | null;
};

/** The pending cuota a debit pays: its amount, and the closest due date
 *  within a month of the line. */
export function findLoanInstallment(
  line: Pick<StatementLine, "amount" | "line_date">,
  installments: readonly StatementLoanInstallment[],
): StatementLoanInstallment | null {
  // The cuota a debit pays: due within a month of it, the same amount or
  // the closest within 10 % (a bank charges the interest by days, and
  // punitorios and taxes on top), and among equals the closest due date.
  const days = (a: string, b: string) =>
    Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  const debit = -line.amount;
  let best: StatementLoanInstallment | null = null;
  let bestScore = Infinity;
  for (const i of installments) {
    if (days(i.due_date, line.line_date) > 31) continue;
    const gap = Math.abs(i.amount - debit);
    if (gap > i.amount * 0.1 + 0.005) continue;
    const score = gap * 1000 + days(i.due_date, line.line_date);
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/** How to split a debit that is not the cuota's amount: the plan's capital
 *  and IVA, and the rest as interest; the user moves punitorios and taxes
 *  out of it from the bank's detail of the cuota. */
export function suggestLoanSplit(
  debit: number,
  installment: Pick<StatementLoanInstallment, "capital" | "iva" | "tax_rate">,
) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const capital = Math.min(installment.capital, debit);
  const iva = Math.min(installment.iva, round2(debit - capital));
  // The rest is interest plus the taxes on it, at the rate of the last cuota.
  const rest = round2(debit - capital - iva);
  const rate = installment.tax_rate ?? 0;
  const interest = rate > 0 ? round2(rest / (1 + rate)) : rest;
  return {
    capital,
    interest,
    late_interest: 0,
    iva,
    taxes: round2(rest - interest),
  };
}

export function proposeLine(
  line: Pick<
    StatementLine,
    "bank_code" | "description" | "amount" | "line_date"
  >,
  codes: readonly BankStatementCode[],
  clientsByCuit: ReadonlyMap<string, StatementClient>,
  installments: readonly StatementLoanInstallment[] = [],
  companyCuit: string | null = null,
  saleTransfers: readonly StatementCheckSaleTransfer[] = [],
  cardStatements: readonly StatementCardStatement[] = [],
): LineProposal {
  const code = findBankCode(line, codes);
  // Money from or to the company itself: a transfer between its accounts,
  // whatever the bank calls it.
  if (companyCuit && cuitsIn(line.description).includes(companyCuit)) {
    return {
      kind: "transfer",
      code,
      label: "Transferencia entre cuentas propias",
      client: null,
      installment: null,
      ready: false,
      missing: null,
    };
  }
  if (!code) {
    return {
      kind: null,
      code: null,
      label: line.bank_code
        ? `Código ${line.bank_code} sin configurar`
        : "Concepto sin configurar",
      client: null,
      installment: null,
      ready: false,
      missing: line.bank_code
        ? "Configurá qué es este código."
        : "Configurá qué es este concepto.",
    };
  }
  const label = code.label ?? (code.bank_code || code.description_pattern);
  if (code.kind === "tax" || code.kind === "bank_fee") {
    return {
      kind: code.kind,
      code,
      label: code.chart_account_label
        ? `${label} → ${code.chart_account_label}`
        : label,
      client: null,
      installment: null,
      ready: code.chart_account_id !== null && line.amount < 0,
      missing:
        code.chart_account_id === null ? "Elegí la cuenta contable." : null,
    };
  }
  if (code.kind === "receipt") {
    const client =
      cuitsIn(line.description)
        .map((c) => clientsByCuit.get(c))
        .find((c) => c !== undefined) ?? null;
    return {
      kind: "receipt",
      code,
      label: client
        ? `Cobro de ${client.display_name ?? client.legal_name}`
        : label,
      client,
      installment: null,
      ready: false,
      missing: client
        ? null
        : "Ningún cliente tiene el CUIT de la línea: elegilo o crealo en el recibo.",
    };
  }
  if (code.kind === "card_payment") {
    const card =
      line.amount < 0 ? findCardStatement(line, cardStatements) : null;
    return {
      kind: "card_payment",
      code,
      label: card
        ? `Pago del resumen ${card.statement.label} (${card.currency === "ARS" ? "pesos" : "dólares"})`
        : label,
      client: null,
      installment: null,
      card: card ?? undefined,
      ready: false,
      missing: card
        ? null
        : "No hay un resumen de tarjeta pendiente por este pago: subilo en Tesorería › Tarjetas.",
    };
  }
  if (code.kind === "check_sale") {
    const found =
      line.amount > 0 ? findSaleTransfers(line, saleTransfers) : null;
    return {
      kind: "check_sale",
      code,
      label: found
        ? `Descuento de cheques: ${found.map((t) => t.description.replace(/^Venta cheque (\S+).*$/, "$1")).join(", ")}`
        : label,
      client: null,
      installment: null,
      sale_transfers: found ?? undefined,
      ready: false,
      missing: found
        ? null
        : "No hay cheques vendidos que sumen este crédito: registrá el descuento en Cheques › Vender (con el comprobante del banco).",
    };
  }
  if (code.kind === "loan") {
    const installment = findLoanInstallment(line, installments);
    return {
      kind: "loan",
      code,
      label: installment
        ? `Cuota ${installment.number}/${installment.count} — ${installment.loan_description}`
        : label,
      client: null,
      installment,
      ready: false,
      missing: installment
        ? null
        : "No hay una cuota pendiente de un préstamo de esta cuenta por este importe.",
    };
  }
  return {
    kind: code.kind,
    code,
    label,
    client: null,
    installment: null,
    ready: false,
    missing: null,
  };
}

type PresetCode = {
  bank_code: string;
  description_pattern: string;
  kind: BankCodeKind;
  /** The chart account by code or system role; null = none. */
  account: { code: string } | { role: string } | null;
  label: string;
};

/** Banco Provincia has no code: each movement is read by the start of its
 *  concept, in the monthly .txt («CONCEPTO») and in the home banking
 *  export («Descripción Extendida») alike. */
export const PROVINCIA_CODES: readonly PresetCode[] = [
  {
    bank_code: "",
    description_pattern: "IMPUESTO DEBITO - LEY 25413",
    kind: "tax",
    account: { code: "5.4.3" },
    label: "Impuesto a los débitos (Ley 25.413)",
  },
  {
    bank_code: "",
    description_pattern: "IMPUESTO CREDITO -LEY 25413",
    kind: "tax",
    account: { code: "5.4.3" },
    label: "Impuesto a los créditos (Ley 25.413)",
  },
  {
    bank_code: "",
    description_pattern: "RETENCION ARBA",
    kind: "tax",
    account: { role: "percepciones_iibb_pagadas" },
    label: "Retención ARBA (recaudación IIBB)",
  },
  {
    bank_code: "",
    description_pattern: "IMPUESTO I.BRUTOS - PERCEPCION",
    kind: "tax",
    account: { role: "percepciones_iibb_pagadas" },
    label: "Percepción IIBB sobre comisiones",
  },
  {
    bank_code: "",
    description_pattern: "COMISION",
    kind: "bank_fee",
    account: { code: "5.4.2" },
    label: "Comisión del banco",
  },
  {
    bank_code: "",
    description_pattern: "PAGO CUOTA DE PRESTAMO",
    kind: "loan",
    account: null,
    label: "Cuota de préstamo",
  },
  {
    bank_code: "",
    description_pattern: "PAGO TOTAL CUOTA PMO",
    kind: "loan",
    account: null,
    label: "Cuota de préstamo",
  },
  {
    bank_code: "",
    description_pattern: "TRANSF DE",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "",
    description_pattern: "CR.TRAN.",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
];

/** Banco Macro's "Código Causal": what each one is. */
export const MACRO_CODES: readonly PresetCode[] = [
  {
    bank_code: "1684",
    description_pattern: "",
    kind: "tax",
    account: { code: "5.4.3" },
    label: "Impuesto a los débitos (Ley 25.413)",
  },
  {
    bank_code: "1685",
    description_pattern: "",
    kind: "tax",
    account: { code: "5.4.3" },
    label: "Impuesto a los créditos (Ley 25.413)",
  },
  {
    bank_code: "1794",
    description_pattern: "",
    kind: "tax",
    account: { role: "percepciones_iibb_pagadas" },
    label: "SIRCREB (recaudación IIBB)",
  },
  {
    bank_code: "1469",
    description_pattern: "",
    kind: "tax",
    account: { role: "percepciones_iibb_pagadas" },
    label: "Percepción IIBB",
  },
  {
    bank_code: "2033",
    description_pattern: "",
    kind: "payment",
    account: null,
    label: "Comisión e IVA del banco (factura del banco)",
  },
  {
    bank_code: "361",
    description_pattern: "",
    kind: "loan",
    account: null,
    label: "Cuota de préstamo",
  },
  {
    bank_code: "2027",
    description_pattern: "",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "4016",
    description_pattern: "",
    kind: "receipt",
    account: null,
    label: "CREDIN recibido",
  },
  {
    bank_code: "4060",
    description_pattern: "",
    kind: "receipt",
    account: null,
    label: "Transferencia con factura",
  },
  {
    bank_code: "4543",
    description_pattern: "",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "4081",
    description_pattern: "",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "2018",
    description_pattern: "",
    kind: "transfer",
    account: null,
    label: "Transferencia entre cuentas propias",
  },
];

/** The bank whose known codes fit the statement, for an account with none
 *  yet: Macro by its «Código Causal», Provincia by the text of its concepts.
 *  Two lines that fit are enough; null when neither does. */
export function detectBankPreset(
  lines: readonly Pick<StatementLine, "bank_code" | "description">[],
): BankCodePreset | null {
  const macro = new Set(MACRO_CODES.map((c) => c.bank_code));
  const byText = (["provincia", "galicia"] as const).map((preset) => ({
    preset,
    patterns: PRESET_CODES[preset].map((c) => norm(c.description_pattern)),
  }));
  const hits = new Map<BankCodePreset, number>();
  const add = (p: BankCodePreset) => hits.set(p, (hits.get(p) ?? 0) + 1);
  for (const l of lines) {
    if (l.bank_code) {
      if (macro.has(l.bank_code)) add("macro");
      continue;
    }
    const d = norm(l.description);
    for (const { preset, patterns } of byText) {
      if (patterns.some((p) => hasWords(d, p))) add(preset);
    }
  }
  let best: BankCodePreset | null = null;
  for (const [preset, n] of hits) {
    if (n >= 2 && (!best || n > (hits.get(best) ?? 0))) best = preset;
  }
  return best;
}

/** Banco Galicia has no code either: its concepts, as the home banking
 *  export («Descripción») writes them. A cheque discount comes as a credit
 *  with its interest, IVA, percepción and taxes in lines of their own. */
export const GALICIA_CODES: readonly PresetCode[] = [
  {
    bank_code: "",
    description_pattern: "IMP. DEB. LEY 25413",
    kind: "tax",
    account: { code: "5.4.3" },
    label: "Impuesto a los débitos (Ley 25.413)",
  },
  {
    bank_code: "",
    description_pattern: "IMP. CRE. LEY 25413",
    kind: "tax",
    account: { code: "5.4.3" },
    label: "Impuesto a los créditos (Ley 25.413)",
  },
  {
    bank_code: "",
    description_pattern: "ING. BRUTOS S/ CRED",
    kind: "tax",
    account: { role: "percepciones_iibb_pagadas" },
    label: "Recaudación IIBB sobre créditos (ARBA)",
  },
  {
    bank_code: "",
    description_pattern: "IMP. ING. BRUTOS",
    kind: "tax",
    account: { role: "percepciones_iibb_pagadas" },
    label: "IIBB del descuento de cheques",
  },
  {
    bank_code: "",
    description_pattern: "INTERES NOMINAL",
    kind: "bank_fee",
    account: { role: "intereses_pagados" },
    label: "Interés del descuento de cheques",
  },
  {
    bank_code: "",
    description_pattern: "IVA",
    kind: "tax",
    account: { role: "iva_credito" },
    label: "IVA del descuento de cheques",
  },
  {
    bank_code: "",
    description_pattern: "PERCEP. IVA",
    kind: "tax",
    account: { role: "percepciones_iva_pagadas" },
    label: "Percepción de IVA",
  },
  {
    bank_code: "",
    description_pattern: "IMPUESTO DE SELLOS",
    kind: "tax",
    account: { code: "5.4.4" },
    label: "Impuesto de sellos",
  },
  {
    bank_code: "",
    description_pattern: "COM. DEPOSITO DE CHEQUE",
    kind: "bank_fee",
    account: { code: "5.4.2" },
    label: "Comisión por depósito de cheque",
  },
  {
    bank_code: "",
    description_pattern: "TRANSFERENCIA DE TERCEROS",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "",
    description_pattern: "CREDITO TRANSFERENCIA COELSA",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "",
    description_pattern: "TRANSFERENCIAS CASH PROVEEDORES",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "",
    description_pattern: "SERVICIO PAGO A PROVEEDORES",
    kind: "receipt",
    account: null,
    label: "Transferencia recibida",
  },
  {
    bank_code: "",
    description_pattern: "CUOTA DE PRESTAMO",
    kind: "loan",
    account: null,
    label: "Cuota de préstamo",
  },
  {
    bank_code: "",
    description_pattern: "TRANSF. CTAS PROPIAS",
    kind: "transfer",
    account: null,
    label: "Transferencia entre cuentas propias",
  },
  {
    bank_code: "",
    description_pattern: "PAGO VISA EMPRESA",
    kind: "card_payment",
    account: null,
    label: "Pago de la tarjeta VISA",
  },
  {
    bank_code: "",
    description_pattern: "CREDITO DESCUENTO DOCUMENTO",
    kind: "check_sale",
    account: null,
    label: "Crédito por descuento de cheques",
  },
  {
    bank_code: "",
    description_pattern: "COMISION",
    kind: "bank_fee",
    account: { code: "5.4.2" },
    label: "Comisión del banco",
  },
  {
    bank_code: "",
    description_pattern: "SERVICIO TERMINAL PAYWAY",
    kind: "bank_fee",
    account: { code: "5.4.2" },
    label: "Terminal Payway",
  },
  {
    bank_code: "",
    description_pattern: "INTERESES SOBRE SALDOS DEUDORES",
    kind: "bank_fee",
    account: { role: "intereses_pagados" },
    label: "Intereses por saldo deudor",
  },
  {
    bank_code: "",
    description_pattern: "TRF INMED PROVEED",
    kind: "payment",
    account: null,
    label: "Pago a proveedor",
  },
  {
    bank_code: "",
    description_pattern: "PAGO DE SERVICIOS",
    kind: "payment",
    account: null,
    label: "Pago de servicios",
  },
];

export const PRESET_CODES: Record<BankCodePreset, readonly PresetCode[]> = {
  macro: MACRO_CODES,
  provincia: PROVINCIA_CODES,
  galicia: GALICIA_CODES,
};

/** The transfers of one cheque sale, within 3 days of a discount credit,
 *  that add up to it exactly (the bank credits each «N° de préstamo» apart:
 *  one cheque or a few). */
export function findSaleTransfers(
  line: Pick<StatementLine, "amount" | "line_date">,
  transfers: readonly StatementCheckSaleTransfer[],
): StatementCheckSaleTransfer[] | null {
  const cents = (n: number) => Math.round(n * 100);
  const target = cents(line.amount);
  const near = transfers.filter(
    (t) =>
      Math.abs(Date.parse(t.date) - Date.parse(line.line_date)) <=
      3 * 86_400_000,
  );
  const bySale = new Map<string, StatementCheckSaleTransfer[]>();
  for (const t of near)
    bySale.set(t.sale_id, [...(bySale.get(t.sale_id) ?? []), t]);
  for (const group of bySale.values()) {
    const items = [...group].sort((a, b) => b.amount - a.amount).slice(0, 25);
    let steps = 0;
    const pick: StatementCheckSaleTransfer[] = [];
    const search = (i: number, left: number): boolean => {
      if (left === 0) return true;
      if (i >= items.length || left < 0 || ++steps > 100_000) return false;
      pick.push(items[i]!);
      if (search(i + 1, left - cents(items[i]!.amount))) return true;
      pick.pop();
      return search(i + 1, left);
    };
    if (search(0, target)) return [...pick];
  }
  return null;
}

/** The card statement a payment debit pays: the pesos of one whose total
 *  is the debit, else the dollars of the closest one due within 45 days
 *  (the bank debits them apart, at its rate: «SALDO EN USD COTIZACION»). */
export function findCardStatement(
  line: Pick<StatementLine, "amount" | "line_date" | "description">,
  statements: readonly StatementCardStatement[],
): { statement: StatementCardStatement; currency: "ARS" | "USD" } | null {
  const debit = Math.round(-line.amount * 100);
  const ars = statements.find(
    (s) => s.ars_pending && Math.round(s.total_ars * 100) === debit,
  );
  if (ars) return { statement: ars, currency: "ARS" };
  const days = (s: StatementCardStatement) =>
    Math.abs(Date.parse(s.due_date) - Date.parse(line.line_date)) / 86_400_000;
  const usd = statements
    .filter((s) => s.usd_pending && days(s) <= 45)
    .sort((a, b) => days(a) - days(b))[0];
  // A dollar debit says so, or is far below any total in pesos.
  if (
    usd &&
    (/USD|DOLAR/i.test(line.description) || debit < usd.total_ars * 100 * 0.1)
  ) {
    return { statement: usd, currency: "USD" };
  }
  return null;
}
