// Deterministic anomaly detectors over purchase invoices (pure, no DB/LLM).
// Returns findings shaped for ai_insights rows.

import { SCOPE_LABEL, type FiscalFilter } from "@/lib/scope";

import { outlierBounds } from "./statistics";

/** A purchase's scope: its channel's `is_fiscal`, or "none" without channel. */
export type PurchaseScope = Exclude<FiscalFilter, "all"> | "none";

const PURCHASE_SCOPE_LABEL: Record<PurchaseScope, string> = {
  fiscal: SCOPE_LABEL.fiscal,
  internal: SCOPE_LABEL.internal,
  none: "Sin canal",
};

export function purchaseScope(isFiscal: boolean | null): PurchaseScope {
  if (isFiscal === null) return "none";
  return isFiscal ? "fiscal" : "internal";
}

export type PurchaseRow = {
  id: string;
  scope: PurchaseScope;
  supplier_id: string;
  supplier_name: string;
  imp_total: number;
  fecha: string; // YYYY-MM-DD
  numero: number;
  punto_venta: number;
};

export type AnomalyFinding = {
  kind: "dup_invoice" | "unusual_amount";
  severity: "info" | "warning" | "critical";
  title: string;
  finding: string;
  metrics: Record<string, unknown>;
  source_refs: string[]; // invoice ids
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DUP_WINDOW_DAYS = 30;
const MIN_HISTORY = 5;

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function pvNum(r: PurchaseRow): string {
  return `${String(r.punto_venta).padStart(5, "0")}-${String(r.numero).padStart(8, "0")}`;
}

/**
 * Same scope + supplier + same total within a 30-day window but a different
 * voucher number → likely a double-loaded / double-paid invoice. One finding
 * per cluster. A fiscal and an internal invoice never pair up.
 */
export function detectDuplicateInvoices(rows: PurchaseRow[]): AnomalyFinding[] {
  const byKey = new Map<string, PurchaseRow[]>();
  for (const r of rows) {
    const key = `${r.scope}|${r.supplier_id}|${r.imp_total}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  const findings: AnomalyFinding[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => dayNum(a.fecha) - dayNum(b.fecha));
    // Keep the cluster only if some pair is within the window and not the exact
    // same voucher (distinct pv+numero).
    const within =
      dayNum(sorted[sorted.length - 1]!.fecha) - dayNum(sorted[0]!.fecha) <=
      DUP_WINDOW_DAYS;
    const distinctVouchers =
      new Set(group.map((r) => `${r.punto_venta}-${r.numero}`)).size > 1;
    if (!within || !distinctVouchers) continue;

    const first = sorted[0]!;
    findings.push({
      kind: "dup_invoice",
      severity: "warning",
      title: "Posible factura duplicada",
      finding: `${PURCHASE_SCOPE_LABEL[first.scope]} · ${first.supplier_name}: ${group.length} facturas por ${money(
        first.imp_total,
      )} en ≤${DUP_WINDOW_DAYS} días (${group.map(pvNum).join(", ")}). Revisá que no sea un doble cargo.`,
      metrics: {
        scope: first.scope,
        supplier_id: first.supplier_id,
        amount: first.imp_total,
        count: group.length,
        vouchers: group.map(pvNum),
      },
      source_refs: group.map((r) => r.id),
    });
  }
  return findings;
}

/**
 * Per scope and supplier with enough history, flag invoices whose total is well
 * above the supplier's usual range in that scope (Tukey upper fence). High
 * outliers only — a much larger-than-usual bill is the money-risk one.
 */
export function detectUnusualAmounts(rows: PurchaseRow[]): AnomalyFinding[] {
  const bySupplier = new Map<string, PurchaseRow[]>();
  for (const r of rows) {
    const key = `${r.scope}|${r.supplier_id}`;
    const arr = bySupplier.get(key) ?? [];
    arr.push(r);
    bySupplier.set(key, arr);
  }

  const findings: AnomalyFinding[] = [];
  for (const group of bySupplier.values()) {
    if (group.length < MIN_HISTORY) continue;
    const bounds = outlierBounds(
      group.map((r) => r.imp_total),
      MIN_HISTORY,
    );
    if (!bounds) continue;
    for (const r of group) {
      if (r.imp_total > bounds.upper) {
        findings.push({
          kind: "unusual_amount",
          severity: "warning",
          title: "Importe inusual de proveedor",
          finding: `${PURCHASE_SCOPE_LABEL[r.scope]} · ${r.supplier_name}: factura ${pvNum(r)} por ${money(
            r.imp_total,
          )}, muy por encima de su rango habitual (${money(bounds.q1)}–${money(
            bounds.q3,
          )}).`,
          metrics: {
            scope: r.scope,
            supplier_id: r.supplier_id,
            amount: r.imp_total,
            q1: bounds.q1,
            q3: bounds.q3,
            upper: bounds.upper,
          },
          source_refs: [r.id],
        });
      }
    }
  }
  return findings;
}

export function detectAnomalies(rows: PurchaseRow[]): AnomalyFinding[] {
  return [...detectDuplicateInvoices(rows), ...detectUnusualAmounts(rows)];
}
