import { isValidCuit } from "@/lib/validation/cuit";

import type {
  BankCodeKind,
  BankStatementCode,
  StatementClient,
  StatementLine,
} from "../schema";

function norm(text: string): string {
  return text.toUpperCase().replace(/\s+/g, " ").trim();
}

/** The code that says what a line is: among the codes of its bank code, the
 *  one whose text the description contains (the longest wins), else the one
 *  for the whole code. */
export function findBankCode(
  line: Pick<StatementLine, "bank_code" | "description">,
  codes: readonly BankStatementCode[],
): BankStatementCode | null {
  if (!line.bank_code) return null;
  const description = norm(line.description);
  let best: BankStatementCode | null = null;
  for (const c of codes) {
    if (c.bank_code !== line.bank_code) continue;
    const pattern = norm(c.description_pattern);
    if (pattern !== "" && !description.includes(pattern)) continue;
    if (!best || pattern.length > norm(best.description_pattern).length) {
      best = c;
    }
  }
  return best;
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
  /** Can be accepted in one click: a tax or fee with its account. */
  ready: boolean;
  /** What is missing to book it, when something is. */
  missing: string | null;
};

export function proposeLine(
  line: Pick<StatementLine, "bank_code" | "description" | "amount">,
  codes: readonly BankStatementCode[],
  clientsByCuit: ReadonlyMap<string, StatementClient>,
): LineProposal {
  const code = findBankCode(line, codes);
  if (!code) {
    return {
      kind: null,
      code: null,
      label: line.bank_code
        ? `Código ${line.bank_code} sin configurar`
        : "Sin código del banco",
      client: null,
      ready: false,
      missing: line.bank_code ? "Configurá qué es este código." : null,
    };
  }
  const label = code.label ?? code.bank_code;
  if (code.kind === "tax" || code.kind === "bank_fee") {
    return {
      kind: code.kind,
      code,
      label: code.chart_account_label
        ? `${label} → ${code.chart_account_label}`
        : label,
      client: null,
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
      ready: false,
      missing: client ? null : "No hay un cliente con el CUIT de la línea.",
    };
  }
  return {
    kind: code.kind,
    code,
    label,
    client: null,
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
