import { z } from "zod";

import type { CurrencyAmounts } from "@/lib/aging";
import { highestRole, type Role } from "@/lib/auth/permissions";

export const DUE_DATE_KINDS = [
  "received_check",
  "issued_check",
  "loan_installment",
  "recurring_payment",
  "fleet_document",
  "employee_document",
] as const;

export type DueDateKind = (typeof DUE_DATE_KINDS)[number];

export interface DueDateItem {
  id: string;
  kind: DueDateKind;
  /** ISO date (YYYY-MM-DD) of the due/expiry date. */
  date: string;
  label: string;
  detail: string | null;
  amount: number | null;
  currency: "ARS" | "USD" | null;
  /** "in" = money coming in, "out" = money going out, null = compliance. */
  direction: "in" | "out" | null;
  href: string;
}

/** The agenda, and the sections whose read failed (their items are
 *  missing, not absent). */
export interface DueDates {
  items: DueDateItem[];
  failed: string[];
}

export interface DashboardTreasuryKpis {
  as_of: string;
  liquid_now: { ARS: number; USD: number };
  liquid_prev_eom: { ARS: number; USD: number };
  usd_rate: { rate: number; rate_date: string } | null;
  checks_now: number;
  /** USD check carteras, kept apart from the ARS ones. */
  checks_usd_now: number;
  /** ARS checks only. */
  checks_due_soon: { count: number; amount: number };
}

export interface DashboardAgingKpis {
  total: CurrencyAmounts;
  /** ARS + USD at the latest official rate; null when there is USD and no rate. */
  total_ars_equivalent: number | null;
  bucket_90_plus: CurrencyAmounts;
  party_count: number;
}

export interface TopDebtor {
  client_id: string;
  name: string;
  cuit: string | null;
  total: CurrencyAmounts;
  total_ars_equivalent: number | null;
  oldest_days: number;
}

/** Structural subset of treasury's MonthFlow — filled at the app layer. */
export interface CashFlowChartMonth {
  month: string;
  realized: boolean;
  inTotal: number;
  outTotal: number;
  net: number;
  closing: number | null;
}

export interface CashFlowChartData {
  months: CashFlowChartMonth[];
  cashToday: number;
  lowestClosing: number | null;
  deficitMonth: string | null;
  /** Latest USD→ARS rate used by the cash-flow action (null = ARS only). */
  usdRate: number | null;
  /** USD items left out for lack of a loaded rate: the figures are partial. */
  usdSkipped: boolean;
}

/** null = the caller lacks that section's read permission. */
export interface OpsKpis {
  trips_in_progress: number | null;
  shipments_pending: number | null;
  pallets_stored: number | null;
}

// ---------------------------------------------------------------------------
// "Hoy y esta semana" (decision D12)
// ---------------------------------------------------------------------------

/** A trip of today, with the clients of its loads. */
export interface TodayTrip {
  id: string;
  /** The trip's page (its cargas) with shipments:read, else the trips list. */
  href: string;
  status: string;
  patente: string | null;
  driver: string | null;
  clients: string[];
  origin: string | null;
  destination: string | null;
}

export const PAPER_HOLDER_KINDS = ["vehicle", "driver", "employee"] as const;
export type PaperHolderKind = (typeof PAPER_HOLDER_KINDS)[number];

export const PAPER_HOLDER_LABEL: Record<PaperHolderKind, string> = {
  vehicle: "Camiones",
  driver: "Choferes",
  employee: "Empleados",
};

/** A document to renew: expired, or expiring within 30 days. */
export interface PendingPaper {
  id: string;
  holder_kind: PaperHolderKind;
  holder: string;
  kind: string;
  expires_at: string;
  expired: boolean;
  href: string;
}

/** null = the caller lacks that tile's read permission (the tile hides);
 *  a failed read is an error the tile shows, never an empty list. */
export type TodayTile<T> = { ok: true; data: T } | { ok: false; error: string };

export interface DashboardToday {
  trips: TodayTile<TodayTrip[]> | null;
  papers: TodayTile<PendingPaper[]> | null;
}

/** An open task due by the end of the week (or already overdue). */
export interface TodayTask {
  id: string;
  title: string;
  due_date: string;
  href: string;
}

// ---------------------------------------------------------------------------
// Customizable layout (dashboard_layouts table)
// ---------------------------------------------------------------------------

export const WIDGET_IDS = [
  "finance_kpis",
  "ops_kpis",
  "cash_flow",
  "insights",
  "due_dates",
  "top_debtors",
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export const WIDGET_LABEL: Record<WidgetId, string> = {
  finance_kpis: "Indicadores financieros",
  ops_kpis: "Operaciones",
  cash_flow: "Flujo de caja",
  insights: "Insights IA",
  due_dates: "Próximos vencimientos",
  top_debtors: "Top deudores",
};

export const WIDGET_SIZES = ["half", "full"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export const LayoutItemSchema = z.object({
  id: z.enum(WIDGET_IDS),
  size: z.enum(WIDGET_SIZES),
});

export const DashboardLayoutSchema = z
  .array(LayoutItemSchema)
  .max(WIDGET_IDS.length)
  .refine(
    (items) => new Set(items.map((i) => i.id)).size === items.length,
    "Widgets duplicados.",
  );

export type LayoutItem = z.infer<typeof LayoutItemSchema>;
export type DashboardLayout = LayoutItem[];

const FINANCE_TEMPLATE: DashboardLayout = [
  { id: "finance_kpis", size: "full" },
  { id: "cash_flow", size: "full" },
  { id: "insights", size: "full" },
  { id: "due_dates", size: "half" },
  { id: "top_debtors", size: "half" },
  { id: "ops_kpis", size: "full" },
];

const OPERATIONS_TEMPLATE: DashboardLayout = [
  { id: "ops_kpis", size: "full" },
  { id: "due_dates", size: "half" },
  { id: "insights", size: "half" },
];

const WAREHOUSE_TEMPLATE: DashboardLayout = [
  { id: "ops_kpis", size: "full" },
  { id: "due_dates", size: "full" },
];

const DRIVER_TEMPLATE: DashboardLayout = [{ id: "ops_kpis", size: "full" }];

/** Default template when the user has no saved layout, by highest role. */
export function defaultLayoutForRoles(roles: readonly Role[]): DashboardLayout {
  const top = highestRole(roles);
  switch (top) {
    case "owner":
    case "admin":
    case "finance":
      return FINANCE_TEMPLATE;
    case "operations":
      return OPERATIONS_TEMPLATE;
    case "warehouse":
      return WAREHOUSE_TEMPLATE;
    case "driver":
      return DRIVER_TEMPLATE;
    // No widget reads fiscal books only: the page shows the module hint.
    case "fiscal_reader":
    default:
      return [];
  }
}
