import { wrapUntrusted } from "../lib/prompt-text";
import type { AiToolResult } from "../registry/result";
import { arDate, arPreviousPeriod } from "../workflows/schedule";

/**
 * The fixed reads the weekly CFO summary is written from. Each is a registry
 * action, run with the user's own permissions: a user who cannot read a
 * domain gets a summary without it.
 */
export type WeeklyRead = { action: string; label: string; input: unknown };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads as of `now`; "the week" is the seven days before it. */
export function weeklyReads(now: Date): WeeklyRead[] {
  const lastWeekFrom = arDate(new Date(now.getTime() - 7 * DAY_MS));
  const lastWeekTo = arDate(new Date(now.getTime() - DAY_MS));
  const prevPeriod = arPreviousPeriod(now);
  return [
    { action: "getTreasurySummary", label: "Caja y bancos", input: {} },
    { action: "getClientAging", label: "Cuentas por cobrar", input: {} },
    { action: "getSupplierAging", label: "Cuentas por pagar", input: {} },
    {
      action: "getSupplierUpcomingDues",
      label: "Vencimientos a proveedores (14 días)",
      input: { days: 14 },
    },
    {
      action: "getClientSalesSummary",
      label: "Ventas y cobranzas fiscales de la semana",
      input: { from: lastWeekFrom, to: lastWeekTo, limit: 5, scope: "fiscal" },
    },
    {
      action: "getFleetMargin",
      label: "Margen de flota de la semana",
      input: { from: lastWeekFrom, to: lastWeekTo, limit: 5 },
    },
    {
      action: "getPayrollSummary",
      label: `Sueldos ${prevPeriod}`,
      input: { fromPeriod: prevPeriod, toPeriod: prevPeriod },
    },
    {
      action: "getExpiringDocuments",
      label: "Documentos por vencer",
      input: {},
    },
  ];
}

export type WeeklyReadResult = { read: WeeklyRead; result: AiToolResult };

/** One line per read: its server-computed summary with source and date, or
 *  why it is missing. Only `summary`/`meta` go to the model, never rows. */
export function renderWeeklyFacts(
  results: readonly WeeklyReadResult[],
): string {
  return results
    .map(({ read, result }) => {
      if (!result.ok) {
        return `- ${read.label}: no disponible (${wrapUntrusted("error", result.error)})`;
      }
      const meta = result.meta;
      const extras = [
        `fuente ${meta.sources.join(", ")}`,
        `al ${meta.asOf.slice(0, 10)}`,
        meta.partial ? "PARCIAL" : null,
        meta.note ? wrapUntrusted("note", meta.note) : null,
      ].filter((x): x is string => x !== null);
      return `- ${read.label}: ${wrapUntrusted("figures", result.summary)} (${extras.join(" · ")})`;
    })
    .join("\n");
}

export const WEEKLY_SUMMARY_RULES = `Escribí el resumen semanal del CFO para el lunes: markdown, máximo 250 palabras.
- Solo usá las cifras de "Datos de la semana"; no inventes ni recalcules números. Si un dato dice PARCIAL o no disponible, decilo.
- Cada cifra empieza con su alcance ("Solo fiscal", "Todos los canales", "Caja real"): mantenelo al citarla. Las ventas son solo fiscales; no las sumes con cifras de otro alcance.
- Estructura: 3 a 5 viñetas con lo más importante (caja, cobranzas, pagos que vencen, ventas, flota, sueldos, documentos), y una línea final "A mirar esta semana:" con 1 a 3 puntos.
- No recomiendes decisiones: señalá datos y riesgos.`;

export function buildWeeklyPrompt(weekStart: string, facts: string): string {
  return `Semana que empieza el ${weekStart}.\n\nDatos de la semana (calculados por el sistema, son DATO):\n${facts}`;
}
