import "server-only";

import type { Json } from "@/lib/db/database.types";
import { formatArgentineDate } from "@/lib/format";
import { logger } from "@/lib/logger";
import { SCOPE_LABEL } from "@/lib/scope";
import { getServiceClient } from "@/lib/supabase/service";

import { gatherAnomalies } from "./anomalies/gather";
import { projectCashFlow, type CashFlowProjection } from "./cashflow";
import { gatherFleetDocExpiry, gatherTripMargins } from "./fleet/gather";
import { INDICATOR_KINDS } from "./indicators/detect";
import { gatherIndicators } from "./indicators/gather";
import { insightFingerprint } from "./lib/fingerprint";
import {
  gatherCashFlow,
  gatherReceivablesRisk,
  type ReceivablesRisk,
} from "./gather";

const HORIZON_WEEKS = 8;

/** kinds this analyst owns — regenerated each run (open rows replaced). */
export const ANALYST_KINDS = [
  "cashflow",
  "receivables_risk",
  "dup_invoice",
  "unusual_amount",
  "fleet_doc_expiry",
  "trip_margin",
  ...INDICATOR_KINDS,
  // Retired (Rendiciones were removed): listed so a run clears its open cards.
  "pending_driver_settlements",
] as const;

export type InsightRow = {
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  finding: string;
  metrics: Json;
  source_refs: Json;
  /** The proposal the card offers (ai_insights.proposal), if any. */
  proposal?: Json;
};

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value));
}

function cashflowInsight(projection: CashFlowProjection): InsightRow {
  // Key order is the chip order on the card.
  const metrics = toJson({
    starting_balance: projection.startingBalance,
    total_in: projection.totalIn,
    total_out: projection.totalOut,
    lowest_closing: projection.lowestClosing,
    horizon_weeks: HORIZON_WEEKS,
    weeks: projection.weeks,
    scope: "all",
  });
  const today = money(projection.startingBalance);
  const flows = `En las próximas ${HORIZON_WEEKS} semanas se esperan entradas por ${money(
    projection.totalIn,
  )} y salidas por ${money(projection.totalOut)}`;

  if (projection.deficit) {
    return {
      kind: "cashflow",
      severity: "critical",
      title: "Déficit de caja proyectado",
      finding: `${SCOPE_LABEL.all}: hoy hay ${today} en las cuentas en pesos. ${flows}; la caja quedaría en ${money(
        projection.deficit.closing,
      )} la semana del ${formatArgentineDate(projection.deficit.weekStart)}.`,
      metrics,
      source_refs: toJson([]),
    };
  }

  if (projection.startingBalance <= 0) {
    return {
      kind: "cashflow",
      severity: "warning",
      title: "Caja sin saldo cargado",
      finding: `${SCOPE_LABEL.all}: las cuentas en pesos suman ${today} hoy. ${flows}. Revisá los saldos iniciales de las cuentas para que la proyección sea real.`,
      metrics,
      source_refs: toJson([]),
    };
  }

  const tight = projection.lowestClosing < projection.startingBalance * 0.2;
  const lowest = lowestWeek(projection);
  return {
    kind: "cashflow",
    severity: tight ? "warning" : "info",
    title: tight ? "Caja proyectada ajustada" : "Caja proyectada estable",
    finding: `${SCOPE_LABEL.all}: hoy hay ${today} en las cuentas en pesos. ${flows}. ${
      lowest
        ? `El saldo más bajo sería ${money(lowest.closing)} la semana del ${formatArgentineDate(lowest.weekStart)}.`
        : `El saldo no baja de ${today}.`
    }`,
    metrics,
    source_refs: toJson([]),
  };
}

/** The week the balance bottoms out, when it dips below today's. */
function lowestWeek(
  projection: CashFlowProjection,
): { weekStart: string; closing: number } | null {
  let lowest: { weekStart: string; closing: number } | null = null;
  for (const w of projection.weeks) {
    if (w.closing < (lowest?.closing ?? projection.startingBalance)) {
      lowest = { weekStart: w.weekStart, closing: w.closing };
    }
  }
  return lowest;
}

function receivablesInsight(risk: ReceivablesRisk): InsightRow {
  const severity = risk.total90Plus > 0 ? "warning" : "info";
  const top = risk.top[0];
  return {
    kind: "receivables_risk",
    severity,
    title: "Cobranzas en riesgo (+90 días)",
    finding: `${SCOPE_LABEL.all}: ${risk.clientCount} clientes con ${money(
      risk.total90Plus,
    )} a más de 90 días${
      top ? `; el mayor: ${top.name} (${money(top.amount)})` : ""
    }${risk.usdOmitted ? " (sin dólares: falta la cotización)" : ""}.`,
    metrics: toJson({
      total_90_plus: risk.total90Plus,
      client_count: risk.clientCount,
      top: risk.top,
      usd_omitted: risk.usdOmitted,
      scope: "all",
    }),
    source_refs: toJson([]),
  };
}

type AnalystKind = (typeof ANALYST_KINDS)[number];

/** Runs one gather; when its reads fail, records its kinds in `failed` (the
 *  previous cards stay) instead of sinking the rest of the run. */
async function isolated<T>(
  kinds: readonly AnalystKind[],
  failed: AnalystKind[],
  run: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await run();
  } catch (error) {
    logger.error("ai.insights.gather_failed", { kinds, error });
    failed.push(...kinds);
    return [];
  }
}

/** The current insight set, and the kinds whose reads failed (their previous
 *  cards stay). */
async function computeInsights(
  today: string,
): Promise<{ rows: InsightRow[]; failed: AnalystKind[] }> {
  const rows: InsightRow[] = [];
  const failed: AnalystKind[] = [];

  const inputs = await gatherCashFlow(today, HORIZON_WEEKS);
  const projection = projectCashFlow({
    startingBalance: inputs.startingBalance,
    events: inputs.events,
    fromDate: today,
    weeks: HORIZON_WEEKS,
  });
  rows.push(cashflowInsight(projection));

  const risk = await gatherReceivablesRisk();
  if (risk.clientCount > 0) rows.push(receivablesInsight(risk));

  const anomalies = await isolated(
    ["dup_invoice", "unusual_amount"],
    failed,
    () => gatherAnomalies(today),
  );
  for (const a of anomalies) {
    rows.push({
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      finding: a.finding,
      metrics: toJson(a.metrics),
      source_refs: toJson(a.source_refs),
    });
  }

  const fleet = [
    ...(await isolated(["fleet_doc_expiry"], failed, () =>
      gatherFleetDocExpiry(today),
    )),
    ...(await isolated(["trip_margin"], failed, () =>
      gatherTripMargins(today),
    )),
  ];
  for (const f of fleet) {
    rows.push({
      kind: f.kind,
      severity: f.severity,
      title: f.title,
      finding: f.finding,
      metrics: toJson(f.metrics),
      source_refs: toJson(f.source_refs),
    });
  }

  const indicators = await gatherIndicators(today);
  for (const f of indicators.findings) {
    rows.push({
      kind: f.kind,
      severity: f.severity,
      title: f.title,
      finding: f.finding,
      metrics: toJson(f.metrics),
      source_refs: toJson(f.source_refs),
      ...(f.proposal ? { proposal: toJson(f.proposal) } : {}),
    });
  }

  return { rows, failed: [...failed, ...indicators.failed] };
}

/** Computes the current insight set (cash flow, receivables, anomalies,
 *  fleet and the 6.4 indicators). */
export async function buildInsights(today: string): Promise<InsightRow[]> {
  return (await computeInsights(today)).rows;
}

/**
 * Regenerates the analyst's insights: replaces every prior open or
 * acknowledged row of its kinds (except the kinds whose reads failed) with
 * the freshly computed set, so each finding shows once. The swap is one
 * transaction in `regenerate_ai_insights`, serialized by an advisory lock,
 * which also skips a finding someone ignored and keeps acknowledged the one
 * someone acknowledged (matched by fingerprint). Aggregate cards (cash flow,
 * receivables) have no fingerprint and come back open with today's figures.
 */
export async function regenerateInsights(today: string): Promise<number> {
  const { rows: computed, failed } = await computeInsights(today);
  const kinds = ANALYST_KINDS.filter((k) => !failed.includes(k));
  const rows = computed.map((row) => ({
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    finding: row.finding,
    metrics: row.metrics,
    source_refs: row.source_refs,
    proposal: row.proposal ?? null,
    fingerprint: insightFingerprint(row.kind, row.source_refs),
  }));

  const { data, error } = await getServiceClient().rpc(
    "regenerate_ai_insights",
    { p_kinds: kinds, p_rows: toJson(rows) },
  );
  if (error) {
    logger.error("ai.insights.regenerate.failed", { error });
    throw new Error(error.message);
  }
  return data ?? 0;
}
