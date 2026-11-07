import { isValidCuit } from "@/lib/validation/cuit";

import type {
  BankCodeKind,
  BankStatementCode,
  StatementClient,
  StatementLine,
  StatementLoanInstallment,
} from "../schema";

function norm(text: string): string {
  return text.toUpperCase().replace(/\s+/g, " ").trim();
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
      if (pattern !== "" && !description.includes(pattern)) continue;
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

export type LineProposal = {
  kind: BankCodeKind | null;
  code: BankStatementCode | null;
  /** What the line is, for the user. */
  label: string;
  /** The client of a collection, found by the CUIT in the description. */
  client: StatementClient | null;
  /** The loan cuota a loan debit pays: same amount, the closest due date. */
  installment: StatementLoanInstallment | null;
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
  const days = (a: string, b: string) =>
    Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  let best: StatementLoanInstallment | null = null;
  for (const i of installments) {
    if (Math.abs(i.amount + line.amount) > 0.005) continue;
    if (days(i.due_date, line.line_date) > 31) continue;
    if (
      !best ||
      days(i.due_date, line.line_date) < days(best.due_date, line.line_date)
    ) {
      best = i;
    }
  }
  return best;
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
      missing: client ? null : "No hay un cliente con el CUIT de la línea.",
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
    label: "SIRCREB (recaudación IIBB)",
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
