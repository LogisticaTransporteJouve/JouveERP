import {
  CLIENT_AGING_PERMISSIONS,
  userCan,
  type Access,
  type Permission,
} from "@/lib/auth/permissions";

/**
 * Which domain permissions an insight card belongs to. A card exposes figures
 * from those domains (cash-flow → treasury balances, receivables risk → AR,
 * duplicate/unusual invoices → AP, fleet cards → fleet), so only users who can
 * read every one of them in the app see it. Mirrors the `ai_insights select`
 * RLS policy (latest in supabase/migrations/20261104060100_aging_snapshots.sql)
 * — keep both in sync when adding a kind.
 */
export const INSIGHT_KIND_PERMISSION: Readonly<
  Record<string, Permission | readonly Permission[]>
> = {
  cashflow: "accounts:read",
  receivables_risk: "receipts:read",
  dup_invoice: "purchase_invoices:read",
  unusual_amount: "purchase_invoices:read",
  fleet_doc_expiry: "fleet_documents:read",
  trip_margin: "trips:read",
  // 6.4 indicators
  client_margin_drop: ["management:read", "invoices:read"],
  vehicle_cost_per_km: ["trips:read", "fuel:read", "maintenance:read"],
  fuel_consumption_outlier: ["fuel:read", "trips:read"],
  late_interest_uncharged: "invoices:read",
  unreconciled_bank_lines: "transactions:read",
  pending_driver_settlements: "receipts:read",
  loan_installments_due: ["accounting:read", "accounts:read"],
  cash_vs_financing: ["accounts:read", "accounting:read"],
  receivables_overdue_growth: CLIENT_AGING_PERMISSIONS,
};

/** The permissions a kind requires, or null for an unmapped kind. */
export function insightKindPermissions(
  kind: string,
): readonly Permission[] | null {
  const mapped = INSIGHT_KIND_PERMISSION[kind];
  if (!mapped) return null;
  return typeof mapped === "string" ? [mapped] : mapped;
}

/**
 * True when `access` may see a card of `kind`. Requires ai:read plus the card's
 * domain permissions; an unmapped kind is visible to ai:admin only (fail
 * closed until it is mapped).
 */
export function canSeeInsight(
  access: Access | null | undefined,
  kind: string,
): boolean {
  if (!userCan(access, "ai:read")) return false;
  const permissions = insightKindPermissions(kind);
  if (!permissions) return userCan(access, "ai:admin");
  return permissions.every((p) => userCan(access, p));
}
