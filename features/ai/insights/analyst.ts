import "server-only";

import type { Json } from "@/lib/db/database.types";
import { formatArgentineDate } from "@/lib/format";
import { logger } from "@/lib/logger";
import { SCOPE_LABEL } from "@/lib/scope";
import { fetchInChunks } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { gatherAnomalies } from "./anomalies/gather";
import { projectCashFlow, type CashFlowProjection } from "./cashflow";
import { gatherFleetInsights } from "./fleet/gather";
import { INDICATOR_KINDS, type IndicatorKind } from "./indicators/detect";
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
    }.`,
    metrics: toJson({
      total_90_plus: risk.total90Plus,
      client_count: risk.clientCount,
      top: risk.top,
      scope: "all",
    }),
    source_refs: toJson([]),
  };
}

/** The current insight set, and the indicator kinds whose reads failed (their
 *  previous cards stay). */
async function computeInsights(
  today: string,
): Promise<{ rows: InsightRow[]; failed: IndicatorKind[] }> {
  const rows: InsightRow[] = [];

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

  const anomalies = await gatherAnomalies(today);
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

  const fleet = await gatherFleetInsights(today);
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

  return { rows, failed: indicators.failed };
}

/** Computes the current insight set (cash flow, receivables, anomalies,
 *  fleet and the 6.4 indicators). */
export async function buildInsights(today: string): Promise<InsightRow[]> {
  return (await computeInsights(today)).rows;
}

/** Drops findings the user already ignored (same fingerprint) and tags the
 *  rest with theirs. */
export function withoutIgnored(
  rows: readonly InsightRow[],
  ignored: ReadonlySet<string>,
): (InsightRow & { fingerprint: string | null })[] {
  return rows
    .map((row) => ({
      ...row,
      fingerprint: insightFingerprint(row.kind, row.source_refs),
    }))
    .filter((row) => !row.fingerprint || !ignored.has(row.fingerprint));
}

/**
 * Regenerates the analyst's insights: replaces every prior open or
 * acknowledged row of its kinds with the freshly computed set, so each finding
 * shows once. A finding someone ignored is skipped; one someone acknowledged
 * keeps that status (matched by fingerprint). Aggregate cards (cash flow,
 * receivables) have no fingerprint and come back open with today's figures.
 */
export async function regenerateInsights(today: string): Promise<number> {
  const { rows: computed, failed } = await computeInsights(today);
  const service = getServiceClient();

  // Only the fingerprints this run produced, in URL-safe chunks: a growing
  // pile of ignored findings is never read whole (PostgREST caps responses).
  const candidates = computed
    .map((row) => insightFingerprint(row.kind, row.source_refs))
    .filter((f): f is string => f !== null);
  const reviewed = await fetchInChunks(candidates, (chunk) =>
    service
      .from("ai_insights")
      .select("fingerprint, status")
      .in("status", ["dismissed", "acknowledged"])
      .in("fingerprint", chunk),
  );
  if (reviewed.error) {
    logger.error("ai.insights.dismissed.failed", { error: reviewed.error });
    throw new Error(reviewed.error.message);
  }
  const fingerprintsWith = (status: string) =>
    new Set(
      reviewed.data
        .filter((r) => r.status === status)
        .map((r) => r.fingerprint)
        .filter((f): f is string => f !== null),
    );
  const acknowledged = fingerprintsWith("acknowledged");
  const rows = withoutIgnored(computed, fingerprintsWith("dismissed")).map(
    (row) => ({
      ...row,
      status:
        row.fingerprint && acknowledged.has(row.fingerprint)
          ? ("acknowledged" as const)
          : ("open" as const),
    }),
  );

  const { error: delError } = await service
    .from("ai_insights")
    .delete()
    .in(
      "kind",
      ANALYST_KINDS.filter((k) => !(failed as readonly string[]).includes(k)),
    )
    .in("status", ["open", "acknowledged"]);
  if (delError) {
    logger.error("ai.insights.delete.failed", { error: delError });
    throw delError;
  }

  if (rows.length > 0) {
    const { error: insError } = await service.from("ai_insights").insert(rows);
    if (insError) {
      logger.error("ai.insights.insert.failed", { error: insError });
      throw insError;
    }
  }
  return rows.length;
}
