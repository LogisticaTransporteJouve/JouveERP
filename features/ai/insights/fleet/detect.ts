// Deterministic fleet insight detectors (pure, no DB/LLM). Findings are shaped
// for ai_insights rows. Card copy is user-facing → Spanish (like the other
// analyst insights).

export type FleetDocRow = {
  id: string;
  expires_at: string; // YYYY-MM-DD
  label: string;
};

export type TripMarginRow = {
  id: string;
  label: string;
  net: number;
  /** Some of its cargas are not invoiced yet (v_trip_revenue). */
  pendingInvoicing: boolean;
};

export type FleetFinding = {
  kind: "fleet_doc_expiry" | "trip_margin";
  severity: "info" | "warning" | "critical";
  title: string;
  finding: string;
  metrics: Record<string, unknown>;
  source_refs: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 30;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

/** Fleet documents (VTV, insurance, license, …) already expired or expiring
 *  within HORIZON_DAYS. One aggregate finding. */
export function detectFleetDocExpiry(
  docs: FleetDocRow[],
  today: string,
): FleetFinding[] {
  const expired = docs.filter((d) => d.expires_at < today);
  const soon = docs.filter(
    (d) =>
      d.expires_at >= today && daysBetween(today, d.expires_at) <= HORIZON_DAYS,
  );
  if (expired.length === 0 && soon.length === 0) return [];

  const urgent = [...expired, ...soon].sort((a, b) =>
    a.expires_at < b.expires_at ? -1 : 1,
  )[0];
  return [
    {
      kind: "fleet_doc_expiry",
      severity: expired.length > 0 ? "critical" : "warning",
      title: "Documentación de flota vencida o por vencer",
      finding:
        `${expired.length} vencido(s) y ${soon.length} por vencer (≤${HORIZON_DAYS} días)` +
        (urgent
          ? `; el más urgente: ${urgent.label} (${urgent.expires_at}).`
          : "."),
      metrics: {
        expired: expired.length,
        expiring_soon: soon.length,
        horizon_days: HORIZON_DAYS,
      },
      source_refs: [...expired, ...soon].map((d) => d.id).slice(0, 50),
    },
  ];
}

/** Trips whose net (revenue − cost − fuel) is negative → losing money. A
 *  trip with cargas still to invoice is left out and counted apart: its
 *  revenue (the invoiced freight, as in «Rentabilidad de flota») is not
 *  known yet, and pending is not a loss. */
export function detectLossTrips(trips: TripMarginRow[]): FleetFinding[] {
  const pending = trips.filter((t) => t.pendingInvoicing).length;
  const losses = trips.filter((t) => !t.pendingInvoicing && t.net < 0);
  if (losses.length === 0) return [];

  const totalLoss = losses.reduce((s, t) => s + t.net, 0);
  const worst = [...losses].sort((a, b) => a.net - b.net)[0];
  return [
    {
      kind: "trip_margin",
      severity: "warning",
      title: "Viajes con margen negativo",
      finding:
        `${losses.length} viaje(s) con pérdida (neto = facturación − costo − combustible), total ${money(totalLoss)}` +
        (worst ? `; el peor: ${worst.label} (${money(worst.net)})` : "") +
        (pending > 0
          ? `. ${pending} viaje(s) con cargas sin facturar no se evaluaron.`
          : "."),
      metrics: {
        loss_count: losses.length,
        total_loss: totalLoss,
        pending_invoicing_count: pending,
      },
      source_refs: losses.map((t) => t.id).slice(0, 50),
    },
  ];
}
