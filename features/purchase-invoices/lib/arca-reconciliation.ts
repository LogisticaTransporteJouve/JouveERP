import { z } from "zod";

import { RECEIVED_VOUCHER_STATUSES } from "../schema";

/** Admin › Puntos de venta › Conciliación con ARCA, Compras tab. */
export const ARCA_RECONCILIATION_PURCHASES_HREF =
  "/admin/afip/puntos-de-venta?tab=compras#conciliacion";

/** Rows of each list the detail returns at most. */
export const RECONCILIATION_DETAIL_LIMIT = 200;

const amount = z.coerce.number();

export const ReconciliationMonthSchema = z.object({
  month: z.string(),
  arca_count: z.number().int(),
  arca_uncomparable: z.number().int(),
  arca_neto: amount,
  arca_iva: amount,
  arca_trib: amount,
  arca_total: amount,
  erp_count: z.number().int(),
  erp_neto: amount,
  erp_iva: amount,
  erp_trib: amount,
  erp_total: amount,
  arca_only: z.number().int(),
  erp_only: z.number().int(),
  amount_mismatch: z.number().int(),
});
export type ReconciliationMonth = z.infer<typeof ReconciliationMonthSchema>;

export const RECONCILIATION_ISSUES = [
  "arca_only",
  "erp_only",
  "amount_mismatch",
] as const;
export type ReconciliationIssueKind = (typeof RECONCILIATION_ISSUES)[number];

export const ReconciliationIssueSchema = z.object({
  issue: z.enum(RECONCILIATION_ISSUES),
  issue_count: z.number().int(),
  voucher_id: z.string().nullable(),
  voucher_status: z.enum(RECEIVED_VOUCHER_STATUSES).nullable(),
  purchase_invoice_id: z.string().nullable(),
  fecha: z.string(),
  issuer_cuit: z.string().nullable(),
  issuer_name: z.string().nullable(),
  cbte_tipo: z.number().nullable(),
  kind: z.string().nullable(),
  letter: z.string().nullable(),
  punto_venta: z.number(),
  numero: z.number(),
  arca_moneda: z.string().nullable(),
  arca_total: amount.nullable(),
  erp_moneda: z.string().nullable(),
  erp_total: amount.nullable(),
});
export type ReconciliationIssue = z.infer<typeof ReconciliationIssueSchema>;

export type ReconciliationDetail = Record<
  ReconciliationIssueKind,
  { rows: ReconciliationIssue[]; count: number }
>;

export function groupIssues(rows: ReconciliationIssue[]): ReconciliationDetail {
  const out: ReconciliationDetail = {
    arca_only: { rows: [], count: 0 },
    erp_only: { rows: [], count: 0 },
    amount_mismatch: { rows: [], count: 0 },
  };
  for (const row of rows) {
    out[row.issue].rows.push(row);
    out[row.issue].count = row.issue_count;
  }
  return out;
}

/** A year ("2026") or a month ("2026-10"). */
export const ReconciliationPeriodSchema = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/);

/** The first and last day of a period, as ISO dates. */
export function periodRange(period: string): { from: string; to: string } {
  const y = Number(period.slice(0, 4));
  if (period.length === 4) return { from: `${y}-01-01`, to: `${y}-12-31` };
  const m = Number(period.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${last}` };
}

export type SideTotals = {
  count: number;
  neto: number;
  iva: number;
  trib: number;
  total: number;
};

export type ReconciliationPeriod = {
  /** "2026" or "2026-10". */
  period: string;
  arca: SideTotals;
  erp: SideTotals;
  /** ARCA vouchers counted but not summed: amounts unread or a type the
   *  tray does not load. */
  uncomparable: number;
  arcaOnly: number;
  erpOnly: number;
  amountMismatch: number;
};

export type ReconciliationYear = ReconciliationPeriod & {
  months: ReconciliationPeriod[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function monthPeriod(m: ReconciliationMonth): ReconciliationPeriod {
  return {
    period: m.month.slice(0, 7),
    arca: {
      count: m.arca_count,
      neto: m.arca_neto,
      iva: m.arca_iva,
      trib: m.arca_trib,
      total: m.arca_total,
    },
    erp: {
      count: m.erp_count,
      neto: m.erp_neto,
      iva: m.erp_iva,
      trib: m.erp_trib,
      total: m.erp_total,
    },
    uncomparable: m.arca_uncomparable,
    arcaOnly: m.arca_only,
    erpOnly: m.erp_only,
    amountMismatch: m.amount_mismatch,
  };
}

function addSide(a: SideTotals, b: SideTotals): SideTotals {
  return {
    count: a.count + b.count,
    neto: round2(a.neto + b.neto),
    iva: round2(a.iva + b.iva),
    trib: round2(a.trib + b.trib),
    total: round2(a.total + b.total),
  };
}

const ZERO: SideTotals = { count: 0, neto: 0, iva: 0, trib: 0, total: 0 };

/** The months grouped by year, newest year first, months oldest first. */
export function groupByYear(
  months: readonly ReconciliationMonth[],
): ReconciliationYear[] {
  const years = new Map<string, ReconciliationYear>();
  for (const m of months) {
    const p = monthPeriod(m);
    const key = p.period.slice(0, 4);
    const y = years.get(key) ?? {
      period: key,
      arca: ZERO,
      erp: ZERO,
      uncomparable: 0,
      arcaOnly: 0,
      erpOnly: 0,
      amountMismatch: 0,
      months: [],
    };
    years.set(key, {
      ...y,
      arca: addSide(y.arca, p.arca),
      erp: addSide(y.erp, p.erp),
      uncomparable: y.uncomparable + p.uncomparable,
      arcaOnly: y.arcaOnly + p.arcaOnly,
      erpOnly: y.erpOnly + p.erpOnly,
      amountMismatch: y.amountMismatch + p.amountMismatch,
      months: [...y.months, p].sort((a, b) => a.period.localeCompare(b.period)),
    });
  }
  return [...years.values()].sort((a, b) => b.period.localeCompare(a.period));
}

/** ARCA minus ERP, or null when they match (within half a cent). */
export function sideDiff(arca: number, erp: number): number | null {
  const d = round2(arca - erp);
  return Math.abs(d) < 0.005 ? null : d;
}

export function periodReconciled(p: ReconciliationPeriod): boolean {
  return p.arcaOnly + p.erpOnly + p.amountMismatch === 0;
}
