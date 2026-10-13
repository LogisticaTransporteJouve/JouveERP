import { userCan, type Permission, type Role } from "@/lib/auth/permissions";

/**
 * Which domain permission an insight card belongs to. A card exposes figures
 * from that domain (cash-flow → treasury balances, receivables risk → AR,
 * duplicate/unusual invoices → AP, fleet cards → fleet), so only users who can
 * read that domain in the app see it. Mirrors the `ai_insights select` RLS
 * policy (supabase/migrations/20260705110000_ai_hardening.sql) — keep both in
 * sync when adding a kind.
 */
export const INSIGHT_KIND_PERMISSION: Readonly<Record<string, Permission>> = {
  cashflow: "accounts:read",
  receivables_risk: "receipts:read",
  dup_invoice: "purchase_invoices:read",
  unusual_amount: "purchase_invoices:read",
  fleet_doc_expiry: "fleet_documents:read",
  trip_margin: "trips:read",
};

/**
 * True when `roles` may see a card of `kind`. Requires ai:read plus the card's
 * domain permission; an unmapped kind is visible to ai:admin only (fail
 * closed until it is mapped).
 */
export function canSeeInsight(
  roles: readonly Role[] | null | undefined,
  kind: string,
): boolean {
  if (!userCan(roles, "ai:read")) return false;
  const permission = INSIGHT_KIND_PERMISSION[kind];
  if (!permission) return userCan(roles, "ai:admin");
  return userCan(roles, permission);
}
