// Deterministic indicator detectors (roadmap 6.4): pure, no DB or LLM. The
// figures come from SQL (gather.ts); these compare and threshold them and
// shape ai_insights rows. Card copy is user-facing → Spanish.

import { formatArgentineDate } from "@/lib/format";

import type { InsightProposal } from "../../lib/ai-proposal-schema";
import { outlierBounds } from "../anomalies/statistics";

export const INDICATOR_KINDS = [
  "client_margin_drop",
  "vehicle_cost_per_km",
  "fuel_consumption_outlier",
  "late_interest_uncharged",
  "unreconciled_bank_lines",
  "pending_driver_settlements",
  "loan_installments_due",
  "cash_vs_financing",
] as const;

export type IndicatorKind = (typeof INDICATOR_KINDS)[number];

export type IndicatorFinding = {
  kind: IndicatorKind;
  severity: "info" | "warning" | "critical";
  title: string;
  finding: string;
  metrics: Record<string, unknown>;
  /** Record ids the finding points at (its fingerprint); empty for an
   *  aggregate card. */
  source_refs: string[];
  proposal?: InsightProposal;
};

/** Days each side of a period comparison covers. */
export const COMPARE_DAYS = 90;
/** Revenue a client needs in each period for its margin to be compared. */
export const MIN_CLIENT_REVENUE = 100_000;
/** Percentage points of margin lost that raise the card. */
export const MARGIN_DROP_POINTS = 10;
/** Km a vehicle needs in each period for its cost per km to be compared. */
export const MIN_VEHICLE_KM = 1_000;
/** Rise in cost per km that raises the card. */
export const COST_PER_KM_RISE = 0.2;
/** Km a vehicle needs for its consumption to count. */
export const MIN_FUEL_KM = 500;
/** Vehicles needed to tell an outlier apart. */
export const MIN_FLEET_FOR_OUTLIERS = 4;
/** Days an open statement line may wait before it counts as late. */
export const BANK_LINE_MAX_AGE_DAYS = 15;
/** Days a delivered cash-on-delivery carga may wait to be rendered. */
export const SETTLEMENT_MAX_AGE_DAYS = 3;
/** Days a draft rendición may stay unconfirmed. */
export const DRAFT_SETTLEMENT_MAX_AGE_DAYS = 7;
/** Days ahead a loan installment counts as due soon. */
export const LOAN_HORIZON_DAYS = 14;
/** Days the cash vs financing comparison looks back. */
export const CASH_WINDOW_DAYS = 30;

const MAX_REFS = 50;
const TOP = 5;
const DAY_MS = 86_400_000;

function money(n: number, currency: "ARS" | "USD" = "ARS"): string {
  const sign = currency === "USD" ? "US$" : "$";
  return `${sign}${Math.round(n).toLocaleString("es-AR")}`;
}

function num(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("es-AR");
}

function pct(n: number): string {
  return `${num(n)} %`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

function refs(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort().slice(0, MAX_REFS);
}

// ─── Margin per client ───────────────────────────────────────────────────────

export type ClientMarginPair = {
  client_id: string;
  name: string;
  /** Net revenue (no IVA) and direct cost, last COMPARE_DAYS days. */
  revenueNow: number;
  costNow: number;
  /** The same, the COMPARE_DAYS days before. */
  revenuePrev: number;
  costPrev: number;
};

/** Clients whose contribution margin % fell MARGIN_DROP_POINTS or more,
 *  with enough revenue on both sides to compare. */
export function detectClientMarginDrop(
  rows: readonly ClientMarginPair[],
): IndicatorFinding[] {
  const drops = rows
    .filter(
      (r) =>
        r.revenueNow >= MIN_CLIENT_REVENUE &&
        r.revenuePrev >= MIN_CLIENT_REVENUE,
    )
    .map((r) => {
      const now = ((r.revenueNow - r.costNow) / r.revenueNow) * 100;
      const prev = ((r.revenuePrev - r.costPrev) / r.revenuePrev) * 100;
      return { ...r, now, prev, drop: prev - now };
    })
    .filter((r) => r.drop >= MARGIN_DROP_POINTS)
    .sort((a, b) => b.drop - a.drop);
  if (drops.length === 0) return [];
  const worst = drops[0];
  return [
    {
      kind: "client_margin_drop",
      severity: drops.some((d) => d.now < 0) ? "critical" : "warning",
      title: "Margen en baja por cliente",
      finding:
        `${drops.length} cliente(s) bajaron su margen de contribución ${MARGIN_DROP_POINTS} puntos o más ` +
        `(últimos ${COMPARE_DAYS} días contra los ${COMPARE_DAYS} anteriores; ingreso neto menos viajes y combustible)` +
        (worst
          ? `; el mayor: ${worst.name} (de ${pct(worst.prev)} a ${pct(worst.now)}).`
          : "."),
      metrics: {
        client_count: drops.length,
        worst_drop_pts: worst ? round2(worst.drop) : 0,
        compare_days: COMPARE_DAYS,
        top: drops.slice(0, TOP).map((d) => ({
          client_id: d.client_id,
          name: d.name,
          margin_prev_pct: round2(d.prev),
          margin_now_pct: round2(d.now),
          revenue_now: round2(d.revenueNow),
        })),
      },
      source_refs: refs(drops.map((d) => d.client_id)),
    },
  ];
}

// ─── Vehicle cost per km ─────────────────────────────────────────────────────

export type VehicleCostPair = {
  vehicle_id: string;
  patente: string;
  kmNow: number;
  costNow: number;
  kmPrev: number;
  costPrev: number;
};

/** Vehicles whose cost per km (trips + fuel + maintenance) rose
 *  COST_PER_KM_RISE or more, with enough km on both sides. */
export function detectVehicleCostPerKm(
  rows: readonly VehicleCostPair[],
): IndicatorFinding[] {
  const rises = rows
    .filter(
      (r) =>
        r.kmNow >= MIN_VEHICLE_KM &&
        r.kmPrev >= MIN_VEHICLE_KM &&
        r.costPrev > 0,
    )
    .map((r) => {
      const now = r.costNow / r.kmNow;
      const prev = r.costPrev / r.kmPrev;
      return { ...r, now, prev, rise: now / prev - 1 };
    })
    .filter((r) => r.rise >= COST_PER_KM_RISE)
    .sort((a, b) => b.rise - a.rise);
  if (rises.length === 0) return [];
  const worst = rises[0];
  return [
    {
      kind: "vehicle_cost_per_km",
      severity: "warning",
      title: "Costo por km en suba",
      finding:
        `${rises.length} vehículo(s) aumentaron su costo por km ${pct(COST_PER_KM_RISE * 100)} o más ` +
        `(viajes, combustible y mantenimiento; últimos ${COMPARE_DAYS} días contra los ${COMPARE_DAYS} anteriores)` +
        (worst
          ? `; el mayor: ${worst.patente} (de ${money(worst.prev)} a ${money(worst.now)} por km).`
          : "."),
      metrics: {
        vehicle_count: rises.length,
        worst_rise_pct: worst ? round2(worst.rise * 100) : 0,
        compare_days: COMPARE_DAYS,
        top: rises.slice(0, TOP).map((r) => ({
          vehicle_id: r.vehicle_id,
          patente: r.patente,
          cost_per_km_prev: round2(r.prev),
          cost_per_km_now: round2(r.now),
        })),
      },
      source_refs: refs(rises.map((r) => r.vehicle_id)),
    },
  ];
}

// ─── L/100 km outliers ───────────────────────────────────────────────────────

export type VehicleFuelRow = {
  vehicle_id: string;
  patente: string;
  km: number;
  liters: number;
};

/** Vehicles whose L/100 km is above the fleet's upper fence (Q3 + 1.5 IQR),
 *  among those with MIN_FUEL_KM or more. */
export function detectFuelOutliers(
  rows: readonly VehicleFuelRow[],
): IndicatorFinding[] {
  const usable = rows
    .filter((r) => r.km >= MIN_FUEL_KM && r.liters > 0)
    .map((r) => ({ ...r, per100: (r.liters / r.km) * 100 }));
  const bounds = outlierBounds(
    usable.map((r) => r.per100),
    MIN_FLEET_FOR_OUTLIERS,
  );
  if (!bounds) return [];
  const high = usable
    .filter((r) => r.per100 > bounds.upper)
    .sort((a, b) => b.per100 - a.per100);
  if (high.length === 0) return [];
  const median = (bounds.q1 + bounds.q3) / 2;
  const worst = high[0];
  return [
    {
      kind: "fuel_consumption_outlier",
      severity: "warning",
      title: "Consumo de combustible fuera de rango",
      finding:
        `${high.length} vehículo(s) consumen bastante más que el resto de la flota ` +
        `(últimos ${COMPARE_DAYS} días)` +
        (worst
          ? `; el mayor: ${worst.patente} con ${num(worst.per100)} L/100 km contra un rango típico de hasta ${num(bounds.upper)}.`
          : "."),
      metrics: {
        vehicle_count: high.length,
        fleet_upper_l100: round2(bounds.upper),
        fleet_mid_l100: round2(median),
        compare_days: COMPARE_DAYS,
        top: high.slice(0, TOP).map((r) => ({
          vehicle_id: r.vehicle_id,
          patente: r.patente,
          l_per_100km: round2(r.per100),
          km: r.km,
          liters: r.liters,
        })),
      },
      source_refs: refs(high.map((r) => r.vehicle_id)),
    },
  ];
}

// ─── Late interest not charged ───────────────────────────────────────────────

export type LateInterestRow = {
  invoice_id: string;
  client_name: string;
  comprobante: string;
  currency: "ARS" | "USD";
  monthly_rate: number | null;
  interest: number;
};

/** Overdue comprobantes whose interest nobody charged yet. The card offers
 *  the ND of the largest one (pesos first) as a proposal. */
export function detectLateInterestUncharged(
  rows: readonly LateInterestRow[],
  today: string,
): IndicatorFinding[] {
  const chargeable = rows
    .filter((r) => r.monthly_rate !== null && r.interest > 0)
    .sort(
      (a, b) =>
        Number(b.currency === "ARS") - Number(a.currency === "ARS") ||
        b.interest - a.interest,
    );
  const withoutRate = rows.filter((r) => r.monthly_rate === null).length;
  if (chargeable.length === 0 && withoutRate === 0) return [];

  if (chargeable.length === 0) {
    return [
      {
        kind: "late_interest_uncharged",
        severity: "info",
        title: "Mora sin tasa de interés",
        finding: `${withoutRate} comprobante(s) vencidos con saldo, pero no hay tasa de mora cargada (ni del cliente ni la general): no se puede calcular el interés. Cargala en Intereses por mora.`,
        metrics: { invoice_count: 0, no_rate_count: withoutRate },
        source_refs: [],
      },
    ];
  }

  const ars = chargeable.filter((r) => r.currency === "ARS");
  const usd = chargeable.filter((r) => r.currency === "USD");
  const totalArs = round2(ars.reduce((s, r) => s + r.interest, 0));
  const totalUsd = round2(usd.reduce((s, r) => s + r.interest, 0));
  const top = chargeable[0];
  return [
    {
      kind: "late_interest_uncharged",
      severity: "warning",
      title: "Interés por mora sin cobrar",
      finding:
        `${chargeable.length} comprobante(s) vencidos generan ${money(totalArs)}` +
        (totalUsd > 0 ? ` y ${money(totalUsd, "USD")}` : "") +
        " de interés por mora que todavía no se facturó" +
        (withoutRate > 0 ? ` (${withoutRate} más sin tasa cargada)` : "") +
        (top
          ? `; el mayor: ${top.client_name}, ${top.comprobante} (${money(top.interest, top.currency)}).`
          : "."),
      metrics: {
        invoice_count: chargeable.length,
        total_interest: totalArs,
        total_interest_usd: totalUsd,
        no_rate_count: withoutRate,
      },
      source_refs: refs(chargeable.map((r) => r.invoice_id)),
      ...(top
        ? {
            proposal: {
              action: "proposeLateInterestNd",
              label: "Generar ND por mora",
              input: { invoice_id: top.invoice_id, as_of: today },
            },
          }
        : {}),
    },
  ];
}

// ─── Unreconciled bank lines ─────────────────────────────────────────────────

export type OpenBankLine = {
  id: string;
  account_name: string;
  line_date: string;
  amount: number;
};

/** Open statement lines older than BANK_LINE_MAX_AGE_DAYS. */
export function detectUnreconciledLines(
  lines: readonly OpenBankLine[],
  today: string,
): IndicatorFinding[] {
  const limit = addDays(today, -BANK_LINE_MAX_AGE_DAYS);
  const late = lines.filter((l) => l.line_date < limit);
  if (late.length === 0) return [];
  const byAccount = new Map<string, number>();
  for (const l of late) {
    byAccount.set(l.account_name, (byAccount.get(l.account_name) ?? 0) + 1);
  }
  const [mainAccount] = [...byAccount.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  );
  const oldest = late.reduce(
    (min, l) => (l.line_date < min ? l.line_date : min),
    late[0]?.line_date ?? today,
  );
  const amount = round2(late.reduce((s, l) => s + Math.abs(l.amount), 0));
  return [
    {
      kind: "unreconciled_bank_lines",
      severity: daysBetween(oldest, today) > 45 ? "critical" : "warning",
      title: "Extracto bancario sin conciliar",
      finding:
        `${late.length} línea(s) de extracto llevan más de ${BANK_LINE_MAX_AGE_DAYS} días pendientes ` +
        `en ${byAccount.size} cuenta(s), por ${money(amount)} en total; la más vieja es del ${formatArgentineDate(oldest)}.`,
      metrics: {
        line_count: late.length,
        total_amount: amount,
        account_count: byAccount.size,
        oldest_date: oldest,
      },
      source_refs: refs(late.map((l) => l.id)),
      ...(mainAccount
        ? {
            proposal: {
              action: "proposeTask",
              label: "Crear tarea para conciliar",
              input: {
                title: `Conciliar el extracto de ${mainAccount[0]}`,
                description: `${mainAccount[1]} línea(s) pendientes desde el ${formatArgentineDate(oldest)} (Tesorería › Conciliación).`,
                due_date: addDays(today, 3),
              },
            },
          }
        : {}),
    },
  ];
}

// ─── Driver rendiciones ──────────────────────────────────────────────────────

export type PendingCod = {
  shipment_id: string;
  driver_name: string | null;
  delivery_date: string | null;
  cod_amount: number;
};

export type DraftSettlement = {
  id: string;
  driver_name: string;
  settlement_date: string;
};

/** Delivered cash-on-delivery cargas nobody rendered within
 *  SETTLEMENT_MAX_AGE_DAYS, and draft rendiciones left unconfirmed. */
export function detectPendingSettlements(
  pending: readonly PendingCod[],
  drafts: readonly DraftSettlement[],
  today: string,
): IndicatorFinding[] {
  const codLimit = addDays(today, -SETTLEMENT_MAX_AGE_DAYS);
  const draftLimit = addDays(today, -DRAFT_SETTLEMENT_MAX_AGE_DAYS);
  const late = pending.filter(
    (p) => p.delivery_date !== null && p.delivery_date < codLimit,
  );
  const staleDrafts = drafts.filter((d) => d.settlement_date < draftLimit);
  if (late.length === 0 && staleDrafts.length === 0) return [];

  const byDriver = new Map<string, number>();
  for (const p of late) {
    const who = p.driver_name ?? "Sin chofer";
    byDriver.set(who, (byDriver.get(who) ?? 0) + p.cod_amount);
  }
  const [mainDriver] = [...byDriver.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  );
  const amount = round2(late.reduce((s, p) => s + p.cod_amount, 0));
  const parts = [
    late.length > 0
      ? `${late.length} carga(s) contra entrega entregadas hace más de ${SETTLEMENT_MAX_AGE_DAYS} días sin rendir, por ${money(amount)}, de ${byDriver.size} chofer(es)`
      : null,
    staleDrafts.length > 0
      ? `${staleDrafts.length} rendición(es) en borrador de hace más de ${DRAFT_SETTLEMENT_MAX_AGE_DAYS} días`
      : null,
  ].filter(Boolean);
  const target = mainDriver?.[0] ?? staleDrafts[0]?.driver_name ?? null;
  return [
    {
      kind: "pending_driver_settlements",
      severity: late.length > 0 ? "warning" : "info",
      title: "Rendiciones de choferes pendientes",
      finding:
        `${parts.join("; ")}.` +
        (mainDriver && mainDriver[1] > 0
          ? ` El que más debe rendir: ${mainDriver[0]} (${money(mainDriver[1])}).`
          : ""),
      metrics: {
        shipment_count: late.length,
        total_amount: amount,
        driver_count: byDriver.size,
        draft_count: staleDrafts.length,
      },
      source_refs: refs([
        ...late.map((p) => p.shipment_id),
        ...staleDrafts.map((d) => d.id),
      ]),
      ...(target
        ? {
            proposal: {
              action: "proposeTask",
              label: "Crear tarea de rendición",
              input: {
                title: `Rendir las cobranzas de ${target}`,
                description:
                  "Cargas contra entrega entregadas sin rendir (Cobranzas › Rendiciones).",
                due_date: addDays(today, 1),
              },
            },
          }
        : {}),
    },
  ];
}

// ─── Loan installments ───────────────────────────────────────────────────────

export type LoanInstallmentDue = {
  id: string;
  loan_description: string;
  number: number;
  due_date: string;
  amount: number;
  currency: "ARS" | "USD";
};

/** Pending installments already overdue or due within LOAN_HORIZON_DAYS. */
export function detectLoanInstallmentsDue(
  rows: readonly LoanInstallmentDue[],
  today: string,
): IndicatorFinding[] {
  const horizon = addDays(today, LOAN_HORIZON_DAYS);
  const due = rows
    .filter((r) => r.due_date <= horizon)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1) || a.number - b.number);
  if (due.length === 0) return [];
  const overdue = due.filter((r) => r.due_date < today);
  const totalArs = round2(
    due.filter((r) => r.currency === "ARS").reduce((s, r) => s + r.amount, 0),
  );
  const totalUsd = round2(
    due.filter((r) => r.currency === "USD").reduce((s, r) => s + r.amount, 0),
  );
  const next = due[0];
  return [
    {
      kind: "loan_installments_due",
      severity: overdue.length > 0 ? "critical" : "warning",
      title:
        overdue.length > 0
          ? "Cuotas de préstamos vencidas"
          : "Cuotas de préstamos por vencer",
      finding:
        (overdue.length > 0
          ? `${overdue.length} cuota(s) vencidas sin pagar y `
          : "") +
        `${due.length - overdue.length} que vencen en los próximos ${LOAN_HORIZON_DAYS} días, por ${money(totalArs)}` +
        (totalUsd > 0 ? ` y ${money(totalUsd, "USD")}` : "") +
        (next
          ? `; la primera: cuota ${next.number} de ${next.loan_description}, el ${formatArgentineDate(next.due_date)} (${money(next.amount, next.currency)}).`
          : "."),
      metrics: {
        installment_count: due.length,
        overdue_count: overdue.length,
        total_amount: totalArs,
        total_amount_usd: totalUsd,
        horizon_days: LOAN_HORIZON_DAYS,
      },
      source_refs: refs(due.map((r) => r.id)),
      ...(next
        ? {
            proposal: {
              action: "proposeTask",
              label: "Crear tarea de pago",
              input: {
                title: `Pagar la cuota ${next.number} de ${next.loan_description}`,
                description: `${money(next.amount, next.currency)}, vence el ${formatArgentineDate(next.due_date)} (Tesorería › Préstamos).`,
                due_date: next.due_date < today ? today : next.due_date,
              },
            },
          }
        : {}),
    },
  ];
}

// ─── Cash vs financing ───────────────────────────────────────────────────────

export type CashFinancing = {
  /** Change of the liquid ARS accounts over the window. */
  cashChange: number;
  /** Loan disbursements credited to those accounts in the window. */
  disbursements: number;
  /** Loan installments paid from them in the window. */
  installmentsPaid: number;
};

/** Raised when loans put money in the bank in the window: how much of the
 *  cash change came from financing, and what is left without it. */
export function detectCashVsFinancing(
  input: CashFinancing,
): IndicatorFinding[] {
  if (input.disbursements <= 0) return [];
  const financingNet = round2(input.disbursements - input.installmentsPaid);
  const withoutFinancing = round2(input.cashChange - financingNet);
  const verb = input.cashChange >= 0 ? "subió" : "bajó";
  return [
    {
      kind: "cash_vs_financing",
      severity: withoutFinancing < 0 ? "warning" : "info",
      title:
        withoutFinancing < 0
          ? "La caja se sostiene con financiamiento"
          : "Caja y financiamiento del mes",
      finding:
        `En los últimos ${CASH_WINDOW_DAYS} días la caja en pesos ${verb} ${money(Math.abs(input.cashChange))}; ` +
        `entraron ${money(input.disbursements)} de préstamos y se pagaron ${money(input.installmentsPaid)} de cuotas. ` +
        (withoutFinancing < 0
          ? `Sin ese financiamiento neto la caja habría bajado ${money(Math.abs(withoutFinancing))}.`
          : `Sin el financiamiento neto la variación habría sido de ${money(withoutFinancing)}.`),
      metrics: {
        cash_change: round2(input.cashChange),
        loan_disbursements: round2(input.disbursements),
        installments_paid: round2(input.installmentsPaid),
        change_without_financing: withoutFinancing,
        window_days: CASH_WINDOW_DAYS,
      },
      source_refs: [],
    },
  ];
}
