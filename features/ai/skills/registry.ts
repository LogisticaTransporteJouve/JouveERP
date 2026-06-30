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
    title: "Libros IVA",
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
      "El libro IVA Ventas suma el débito fiscal (IVA de comprobantes emitidos); el libro IVA Compras suma el crédito fiscal (IVA de facturas de compra). El saldo técnico de IVA del período = débito − crédito (a pagar si es positivo). Las percepciones sufridas/practicadas van aparte del IVA. Alícuotas habituales: 21%, 10,5%, 27%, 0% (exento/no gravado). Para el resumen de un período usá las tools de libros IVA y mostrá débito, crédito y saldo.",
  },
  {
    id: "conciliacion",
    title: "Conciliación bancaria",
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
      "Conciliar = cruzar los movimientos del extracto bancario contra los movimientos de caja registrados en la cuenta. Diferencias típicas: cheques emitidos no debitados aún, depósitos en tránsito, comisiones/impuestos bancarios no cargados, e intereses. El saldo conciliado = saldo del extracto ± partidas pendientes. Señalá las partidas sin contraparte como pendientes de registrar.",
  },
  {
    id: "aging-cobranzas",
    title: "Aging y cobranzas",
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
      "El aging clasifica el saldo deudor por antigüedad desde la fecha del comprobante: 0-30, 30-60, 60-90 y +90 días. +90 días es el tramo de riesgo (priorizá gestión de cobro). Solo facturas y ND entran al aging; las NC son crédito al cliente. Para proveedores aplica igual pero como deuda a pagar.",
  },
  {
    id: "comprobantes-afip",
    title: "Comprobantes y letras AFIP",
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
      "La letra del comprobante depende de la condición IVA emisor/receptor: A entre responsables inscriptos (discrimina IVA), B a consumidor final/monotributo/exento, C si el emisor es monotributo. Las NC/ND siguen la letra de la factura que ajustan. El número es punto de venta (5 díg) + número (8 díg). Fiscal lleva CAE de AFIP; los comprobantes internos no.",
  },
  {
    id: "centros-costo",
    title: "Centros de costo y divisiones",
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
      "DZ & Sons opera dos divisiones (DZ Instalaciones, Logística Jouve) × canales fiscal/interno. Los centros de costo permiten imputar gastos e ingresos por área para ver rentabilidad por división. Al analizar gastos, agrupá por centro de costo cuando el usuario pida rentabilidad o resultados por área.",
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
    "## Conocimiento aplicable a esta consulta",
    ...skills.map((s) => `### ${s.title}\n${s.content}`),
  ].join("\n\n");
}
