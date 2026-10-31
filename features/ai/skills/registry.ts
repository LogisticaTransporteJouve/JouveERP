// Chat skills: task-specific accounting know-how injected into the agent's
// system prompt only when the user's message warrants it (keyword scorer +
// char budget). Pure — no DB/LLM. Aurora §4.6 pattern, Argentine domain.

export type SkillDefinition = {
  id: string;
  title: string;
  /** Lowercase trigger terms matched against the user's message. */
  keywords: string[];
  /** Markdown know-how appended to the system prompt when selected. */
  content: string;
};

export const SKILLS: SkillDefinition[] = [
  {
    id: "libro-iva",
    title: "VAT Books",
    keywords: [
      "iva",
      "libro iva",
      "iva ventas",
      "iva compras",
      "crédito fiscal",
      "credito fiscal",
      "débito fiscal",
      "debito fiscal",
      "alícuota",
      "alicuota",
      "percepcion",
      "percepción",
    ],
    content:
      "The VAT Sales book totals the output VAT (débito fiscal, VAT on issued vouchers); the VAT Purchases book totals the input VAT (crédito fiscal, VAT on purchase invoices). The period's technical VAT balance = output − input (payable if positive). Perceptions suffered/applied are kept separate from VAT. Common rates: 21%, 10.5%, 27%, 0% (exempt/not taxed). For a period summary use the VAT book tools and show output VAT, input VAT and balance. The VAT books hold fiscal channels only: never take VAT or billing from internal channels; other tools need scope 'fiscal' for it.",
  },
  {
    id: "conciliacion",
    title: "Bank reconciliation",
    keywords: [
      "conciliación",
      "conciliacion",
      "conciliar",
      "extracto",
      "banco",
      "movimiento bancario",
      "diferencia de saldo",
    ],
    content:
      "Reconciling = matching the bank statement movements against the cash movements recorded in the account. Typical differences: issued checks not yet debited, deposits in transit, bank fees/taxes not yet posted, and interest. The reconciled balance = statement balance ± outstanding items. Flag items with no counterpart as pending to record.",
  },
  {
    id: "aging-cobranzas",
    title: "Aging and collections",
    keywords: [
      "aging",
      "cobranza",
      "cobranzas",
      "deuda",
      "vencido",
      "vencida",
      "incobrable",
      "moroso",
      "cuenta corriente",
      "90 días",
      "90 dias",
    ],
    content:
      "Aging classifies the receivable balance by age since the voucher date: 0-30, 30-60, 60-90 and +90 days. +90 days is the risk bucket (prioritize collection efforts). Only invoices and debit notes (ND) enter the aging; credit notes (NC) are a credit to the customer. For suppliers it works the same but as payable debt.",
  },
  {
    id: "comprobantes-afip",
    title: "AFIP vouchers and letters",
    keywords: [
      "factura a",
      "factura b",
      "factura c",
      "letra",
      "nota de crédito",
      "nota de credito",
      "nota de débito",
      "nota de debito",
      "punto de venta",
      "cae",
      "monotributo",
      "responsable inscripto",
    ],
    content:
      "The voucher letter depends on the VAT status of the issuer/receiver: A between registered taxpayers (responsables inscriptos, VAT itemized), B to final consumer/monotributo/exempt, C when the issuer is monotributo. Credit/debit notes (NC/ND) follow the letter of the invoice they adjust. The number is point of sale (5 digits) + number (8 digits). Fiscal vouchers carry the AFIP CAE; internal vouchers do not.",
  },
  {
    id: "centros-costo",
    title: "Cost centers and divisions",
    keywords: [
      "centro de costo",
      "centros de costo",
      "división",
      "division",
      "rentabilidad",
      "por área",
      "dz instalaciones",
      "logística jouve",
      "logistica jouve",
    ],
    content:
      "DZ & Sons operates Logística Jouve with a fiscal and an internal channel. Cost centers let you allocate expenses and income by area to see profitability per area. When analyzing expenses, group by cost center whenever the user asks for profitability or results by area.",
  },
];

function scoreSkill(skill: SkillDefinition, text: string): number {
  let score = 0;
  for (const kw of skill.keywords) {
    if (text.includes(kw)) score += 1;
  }
  return score;
}

/**
 * Picks the skills whose keywords appear in the message, best-scoring first,
 * greedily filling a character budget so the prompt stays lean.
 */
export function selectSkills(
  message: string,
  opts: { maxChars?: number } = {},
): SkillDefinition[] {
  const maxChars = opts.maxChars ?? 4000;
  const text = message.toLowerCase();
  const scored = SKILLS.map((s) => ({ s, score: scoreSkill(s, text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const out: SkillDefinition[] = [];
  let used = 0;
  for (const { s } of scored) {
    if (used + s.content.length > maxChars) continue;
    out.push(s);
    used += s.content.length;
  }
  return out;
}

/** Renders the selected skills as a system-prompt appendix (empty if none). */
export function buildSkillsBlock(message: string): string {
  const skills = selectSkills(message);
  if (skills.length === 0) return "";
  return [
    "",
    "## Knowledge applicable to this query",
    ...skills.map((s) => `### ${s.title}\n${s.content}`),
  ].join("\n\n");
}
