import "server-only";

import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { SCOPE_LABEL } from "@/lib/scope";
import { fetchInChunks } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { gatherAnomalies } from "./anomalies/gather";
import { projectCashFlow, type CashFlowProjection } from "./cashflow";
import { gatherFleetInsights } from "./fleet/gather";
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
] as const;

export type InsightRow = {
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  finding: string;
  metrics: Json;
  source_refs: Json;
};

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value));
}

function cashflowInsight(projection: CashFlowProjection): InsightRow {
  const metrics = toJson({
    starting_balance: projection.startingBalance,
    lowest_closing: projection.lowestClosing,
    total_in: projection.totalIn,
    total_out: projection.totalOut,
    horizon_weeks: HORIZON_WEEKS,
    weeks: projection.weeks,
    scope: "all",
  });

  if (projection.deficit) {
    return {
      kind: "cashflow",
      severity: "critical",
      title: "Déficit de caja proyectado",
      finding: `${SCOPE_LABEL.all}: la caja proyectada (ARS) cae a ${money(
        projection.deficit.closing,
      )} la semana del ${projection.deficit.weekStart}. Hoy: ${money(
        projection.startingBalance,
      )}.`,
      metrics,
      source_refs: toJson([]),
    };
  }

  const severity =
    projection.lowestClosing < projection.startingBalance * 0.2
      ? "warning"
      : "info";
  return {
    kind: "cashflow",
    severity,
    title:
      severity === "warning"
        ? "Caja proyectada ajustada"
        : "Caja proyectada estable",
    finding: `${SCOPE_LABEL.all}: en ${HORIZON_WEEKS} semanas la caja (ARS) toca un mínimo de ${money(
      projection.lowestClosing,
    )} (hoy ${money(projection.startingBalance)}). Sin déficit proyectado.`,
    metrics,
    source_refs: toJson([]),
  };
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

/** Computes the current insight set (cash-flow + receivables risk). */
export async function buildInsights(today: string): Promise<InsightRow[]> {
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

  return rows;
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
 * Regenerates the analyst's insights: replaces prior OPEN rows of its kinds
 * (acknowledged/dismissed are kept) with the freshly computed set, minus the
 * findings someone ignored.
 */
export async function regenerateInsights(today: string): Promise<number> {
  const computed = await buildInsights(today);
  const service = getServiceClient();

  // Only the fingerprints this run produced, in URL-safe chunks: a growing
  // pile of ignored findings is never read whole (PostgREST caps responses).
  const candidates = computed
    .map((row) => insightFingerprint(row.kind, row.source_refs))
    .filter((f): f is string => f !== null);
  const dismissed = await fetchInChunks(candidates, (chunk) =>
    service
      .from("ai_insights")
      .select("fingerprint")
      .eq("status", "dismissed")
      .in("fingerprint", chunk),
  );
  if (dismissed.error) {
    logger.error("ai.insights.dismissed.failed", { error: dismissed.error });
    throw new Error(dismissed.error.message);
  }
  const rows = withoutIgnored(
    computed,
    new Set(
      dismissed.data
        .map((r) => r.fingerprint)
        .filter((f): f is string => f !== null),
    ),
  );

  const { error: delError } = await service
    .from("ai_insights")
    .delete()
    .in("kind", [...ANALYST_KINDS])
    .eq("status", "open");
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
