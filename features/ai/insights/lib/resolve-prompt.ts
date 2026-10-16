/** Records listed in the seeded question; the assistant can look up more. */
const MAX_REFS = 10;
const MAX_CHARS = 3_000;

const KIND_LABEL: Record<string, string> = {
  cashflow: "caja proyectada",
  receivables_risk: "cobranzas en riesgo",
  dup_invoice: "posible factura de proveedor duplicada",
  unusual_amount: "monto inusual de proveedor",
  fleet_doc_expiry: "documentos de flota por vencer",
  trip_margin: "viajes con pérdida",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scalarMetrics(metrics: unknown): string[] {
  if (!isRecord(metrics)) return [];
  return Object.entries(metrics)
    .filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === "number" || typeof entry[1] === "string",
    )
    .map(([key, value]) => `${key}=${value}`);
}

/**
 * The first chat message of "Resolver con IA": the alert as the analyst
 * stored it (kind, figures, record ids) and what the user wants from the
 * assistant. Kept under the chat's message limit.
 */
export function buildResolvePrompt(insight: {
  kind: string;
  severity: string;
  title: string;
  finding: string;
  metrics: unknown;
  source_refs: unknown;
  generated_at: string;
}): string {
  const refs = Array.isArray(insight.source_refs)
    ? insight.source_refs.filter((r): r is string => typeof r === "string")
    : [];
  const metrics = scalarMetrics(insight.metrics);
  const lines = [
    "Ayudame a resolver esta alerta del analista de IA.",
    `Tipo: ${KIND_LABEL[insight.kind] ?? insight.kind} · Severidad: ${insight.severity} · Generada: ${insight.generated_at.slice(0, 10)}`,
    `Alerta: ${insight.title}. ${insight.finding}`,
    ...(metrics.length > 0 ? [`Cifras: ${metrics.join(", ")}`] : []),
    ...(refs.length > 0
      ? [
          `Registros (ids): ${refs.slice(0, MAX_REFS).join(", ")}${
            refs.length > MAX_REFS ? ` y ${refs.length - MAX_REFS} más` : ""
          }`,
        ]
      : []),
    "Revisá esos datos con tus consultas, explicame la causa probable y qué opciones tengo. Si hay que registrar algo, proponelo para que lo confirme.",
  ];
  return lines.join("\n").slice(0, MAX_CHARS);
}
