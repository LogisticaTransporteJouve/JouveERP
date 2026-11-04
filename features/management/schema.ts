// Resultado de gestión (roadmap 1.0): an internal view of whether the
// operation makes money, fiscal + internal. Never for third parties: the
// fiscal books (EERR, Balance, Libro IVA) are the accountant's.

import { z } from "zod";

import {
  isPayrollPeriodKind,
  payrollPeriodHref,
} from "@/features/hr/payroll-schema";
import { TREASURY_PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import type { CsvCell } from "@/lib/export/csv";
import { round2 } from "@/lib/format";
import { PeriodSchema } from "@/lib/validation/common";

export const MANAGEMENT_BASES = ["accrual", "cash"] as const;
export type ManagementBasis = (typeof MANAGEMENT_BASES)[number];

export function isManagementBasis(value: unknown): value is ManagementBasis {
  return (
    typeof value === "string" &&
    (MANAGEMENT_BASES as readonly string[]).includes(value)
  );
}

export const MANAGEMENT_BASIS_LABEL: Record<ManagementBasis, string> = {
  accrual: "Devengado",
  cash: "Percibido",
};

/** Buckets an account can be mapped to (management_buckets.bucket). */
export const MANAGEMENT_BUCKETS = [
  "service_revenue",
  "operating_cost",
  "financing_cost",
  "loan_principal",
  "fleet_investment",
  "asset_sale",
  "neutral",
  "excluded_noncash",
] as const;
export type ManagementBucket = (typeof MANAGEMENT_BUCKETS)[number];

/** Buckets a P&L row can carry: the mapped ones (minus neutral, which the
 *  RPC drops), a result account without mapping, USD without a rate, and
 *  (cash basis only) advances to staff, net of what the planilla took back,
 *  and the loan disbursements received. */
export const ROW_BUCKETS = [
  ...MANAGEMENT_BUCKETS.filter((b) => b !== "neutral"),
  "unclassified",
  "pending_usd",
  "employee_advances",
  "loan_disbursements",
] as const;
export type RowBucket = (typeof ROW_BUCKETS)[number];

export const OPERATING_SUBBUCKETS = [
  "sueldos",
  "sueldos_internos",
  "cargas_sociales",
  "combustible",
  "mantenimiento",
  "seguros",
  "peajes",
  "alquileres",
  "impuestos",
  "administracion",
  "proveedores",
  "otros",
] as const;
export const FINANCING_SUBBUCKETS = [
  "intereses",
  "cargos_bancarios",
  "descuento_cheques",
  "cargos_prestamos",
] as const;
export const SUBBUCKETS = [
  ...OPERATING_SUBBUCKETS,
  ...FINANCING_SUBBUCKETS,
] as const;
export type Subbucket = (typeof SUBBUCKETS)[number];

export const SUBBUCKET_LABEL: Record<Subbucket, string> = {
  sueldos: "Sueldos",
  sueldos_internos: "Sueldos internos (extras)",
  cargas_sociales: "Cargas sociales",
  combustible: "Combustible",
  mantenimiento: "Mantenimiento",
  seguros: "Seguros",
  peajes: "Peajes",
  alquileres: "Alquileres",
  impuestos: "Impuestos operativos",
  administracion: "Administración",
  proveedores: "Pagos a proveedores",
  otros: "Otros",
  intereses: "Intereses",
  cargos_bancarios: "Cargos bancarios",
  descuento_cheques: "Descuento de cheques",
  cargos_prestamos: "Cargos y sellos de préstamos",
};

export const BUCKET_LABEL: Record<ManagementBucket | RowBucket, string> = {
  service_revenue: "Servicios",
  operating_cost: "Costos operativos",
  financing_cost: "Costo financiero",
  loan_principal: "Capital de préstamos",
  fleet_investment: "Inversión en flota",
  asset_sale: "Venta de bienes de uso",
  neutral: "Neutro (no suma)",
  excluded_noncash: "Excluido (no es caja: amortización, RECPAM)",
  unclassified: "Sin clasificar",
  pending_usd: "USD sin cotización",
  employee_advances: "Anticipos al personal",
  loan_disbursements: "Financiamiento recibido",
};

export const CHANNEL_SIDES = ["fiscal", "internal"] as const;
export type ChannelSide = (typeof CHANNEL_SIDES)[number];

function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

export const isRowBucket = (v: unknown): v is RowBucket =>
  isOneOf(ROW_BUCKETS, v);
export const isSubbucket = (v: unknown): v is Subbucket =>
  isOneOf(SUBBUCKETS, v);
export const isChannelSide = (v: unknown): v is ChannelSide =>
  isOneOf(CHANNEL_SIDES, v);
export const isManagementBucket = (v: unknown): v is ManagementBucket =>
  isOneOf(MANAGEMENT_BUCKETS, v);

/** One row of get_management_pnl, narrowed. amount > 0 adds to the result. */
export type ManagementRow = {
  month: string;
  bucket: RowBucket;
  subbucket: Subbucket | null;
  side: ChannelSide;
  accountId: string | null;
  amount: number;
  pendingUsd: number;
  /** The entry's, internal document's or movement's cost center. */
  costCenterId: string | null;
};

export type RawManagementRow = {
  month: string;
  bucket: string;
  subbucket: string | null;
  channel_side: string;
  chart_account_id: string | null;
  amount_ars: number | string;
  pending_usd: number | string;
  /** Absent before 20261103010000. */
  cost_center_id?: string | null;
};

/** Narrows RPC rows; a row with an unknown bucket, subbucket or side is
 *  returned apart so the caller can log it (never dropped silently). */
export function narrowManagementRows(raw: readonly RawManagementRow[]): {
  rows: ManagementRow[];
  unknown: RawManagementRow[];
} {
  const rows: ManagementRow[] = [];
  const unknown: RawManagementRow[] = [];
  for (const r of raw) {
    const sub = r.subbucket;
    if (
      !isRowBucket(r.bucket) ||
      !isChannelSide(r.channel_side) ||
      (sub !== null && !isSubbucket(sub))
    ) {
      unknown.push(r);
      continue;
    }
    rows.push({
      month: r.month,
      bucket: r.bucket,
      subbucket: sub,
      side: r.channel_side,
      accountId: r.chart_account_id,
      amount: Number(r.amount_ars),
      pendingUsd: Number(r.pending_usd),
      costCenterId: r.cost_center_id ?? null,
    });
  }
  return { rows, unknown };
}

export type ManagementCostCenter = { id: string; code: string; name: string };

export const ManagementPnlInputSchema = z
  .object({
    fromPeriod: PeriodSchema,
    toPeriod: PeriodSchema,
    basis: z.enum(MANAGEMENT_BASES).default("accrual"),
    inflation: z.boolean().default(false),
  })
  .refine((v) => v.fromPeriod <= v.toPeriod, {
    message: "El período desde no puede ser posterior al hasta.",
  });

export const ManagementReportInputSchema = z.object({
  fiscalYear: z.number().int().min(2020).max(2100),
  basis: z.enum(MANAGEMENT_BASES),
  inflation: z.boolean(),
});
export type ManagementReportInput = z.infer<typeof ManagementReportInputSchema>;

/** A catalog choice: a bucket, with a subbucket only for the cost buckets. */
export const SetBucketSchema = z
  .object({
    accountId: z.string().uuid(),
    bucket: z.enum(MANAGEMENT_BUCKETS),
    subbucket: z
      .enum(SUBBUCKETS)
      .nullable()
      .refine((s) => s !== "sueldos_internos", {
        message:
          "Sueldos internos sale del canal interno de la cuenta de sueldos.",
      }),
  })
  .refine(
    (v) =>
      v.subbucket === null ||
      (v.bucket === "operating_cost" &&
        isOneOf(OPERATING_SUBBUCKETS, v.subbucket)) ||
      (v.bucket === "financing_cost" &&
        isOneOf(FINANCING_SUBBUCKETS, v.subbucket)),
    { message: "El subrubro no corresponde a esa caja." },
  );

// ---------------------------------------------------------------------------
// Cascade
// ---------------------------------------------------------------------------

export type Waterfall = {
  serviceRevenue: number;
  operatingCost: number;
  unclassified: number;
  operatingMargin: number;
  financingCost: number;
  afterFinancing: number;
  loanPrincipal: number;
  fleetInvestment: number;
  assetSale: number;
  /** Cash only: advances and purchases charged to staff, net of what the
   *  planilla discounted (that part is in salaries). */
  employeeAdvances: number;
  /** Without financing received: what the operation and its investments
   *  left. */
  cashGeneration: number;
  /** Cash only: loan disbursements received, below cash generation. */
  loanDisbursements: number;
  /** cashGeneration + loanDisbursements: what moved in the accounts. */
  cashVariation: number;
  /** Shown apart, never in a total. */
  excludedNoncash: number;
  pendingUsd: number;
};

/** The cascade, in pesos (signed: costs negative). "Sin clasificar" result
 *  accounts count in the operating margin so no peso is left out; USD
 *  without a rate and non-cash items stay out of every total. */
export function computeWaterfall(rows: readonly ManagementRow[]): Waterfall {
  const sum = (bucket: RowBucket) =>
    round2(
      rows.filter((r) => r.bucket === bucket).reduce((a, r) => a + r.amount, 0),
    );
  const serviceRevenue = sum("service_revenue");
  const operatingCost = sum("operating_cost");
  const unclassified = sum("unclassified");
  const operatingMargin = round2(serviceRevenue + operatingCost + unclassified);
  const financingCost = sum("financing_cost");
  const afterFinancing = round2(operatingMargin + financingCost);
  const loanPrincipal = sum("loan_principal");
  const fleetInvestment = sum("fleet_investment");
  const assetSale = sum("asset_sale");
  const employeeAdvances = sum("employee_advances");
  const cashGeneration = round2(
    afterFinancing +
      loanPrincipal +
      fleetInvestment +
      assetSale +
      employeeAdvances,
  );
  const loanDisbursements = sum("loan_disbursements");
  return {
    serviceRevenue,
    operatingCost,
    unclassified,
    operatingMargin,
    financingCost,
    afterFinancing,
    loanPrincipal,
    fleetInvestment,
    assetSale,
    employeeAdvances,
    cashGeneration,
    loanDisbursements,
    cashVariation: round2(cashGeneration + loanDisbursements),
    excludedNoncash: sum("excluded_noncash"),
    pendingUsd: round2(rows.reduce((a, r) => a + r.pendingUsd, 0)),
  };
}

// ---------------------------------------------------------------------------
// Month table
// ---------------------------------------------------------------------------

export type LineKind = "line" | "subtotal" | "total";

/** What a line adds up: the buckets it reads (the drill-down asks the RPC
 *  for those) and the rows it keeps of them. */
type LineScope = {
  buckets: readonly RowBucket[];
  match: (r: ManagementRow) => boolean;
};

export type TableLine = LineScope & {
  key: string;
  label: string;
  kind: LineKind;
  /** Nesting under a heading (0 = top). */
  depth: number;
};

const byBucket = (bucket: RowBucket): LineScope => ({
  buckets: [bucket],
  match: (r) => r.bucket === bucket,
});
const bySub = (bucket: RowBucket, sub: Subbucket): LineScope => ({
  buckets: [bucket],
  match: (r) => r.bucket === bucket && r.subbucket === sub,
});
const anyOf = (...buckets: RowBucket[]): LineScope => ({
  buckets,
  match: (r) => buckets.includes(r.bucket),
});

const OPERATING_DETAIL = OPERATING_SUBBUCKETS.filter(
  (s) => s !== "sueldos" && s !== "sueldos_internos",
);

const CASH_GENERATION_BUCKETS = [
  "service_revenue",
  "operating_cost",
  "unclassified",
  "financing_cost",
  "loan_principal",
  "fleet_investment",
  "asset_sale",
  "employee_advances",
] as const satisfies readonly RowBucket[];

/** The lines of the month table, top to bottom. */
export const TABLE_LINES: readonly TableLine[] = [
  {
    key: "service_revenue",
    label: BUCKET_LABEL.service_revenue,
    kind: "line",
    depth: 0,
    ...byBucket("service_revenue"),
  },
  {
    key: "op:sueldos",
    label: SUBBUCKET_LABEL.sueldos,
    kind: "line",
    depth: 2,
    ...bySub("operating_cost", "sueldos"),
  },
  {
    key: "op:sueldos_internos",
    label: SUBBUCKET_LABEL.sueldos_internos,
    kind: "line",
    depth: 2,
    ...bySub("operating_cost", "sueldos_internos"),
  },
  {
    key: "op:personal",
    label: "Total personal",
    kind: "subtotal",
    depth: 1,
    buckets: ["operating_cost"],
    match: (r) =>
      r.bucket === "operating_cost" &&
      (r.subbucket === "sueldos" || r.subbucket === "sueldos_internos"),
  },
  ...OPERATING_DETAIL.map((sub): TableLine => ({
    key: `op:${sub}`,
    label: SUBBUCKET_LABEL[sub],
    kind: "line",
    depth: 1,
    ...(sub === "otros"
      ? {
          buckets: ["operating_cost"],
          match: (r: ManagementRow) =>
            r.bucket === "operating_cost" &&
            (r.subbucket === "otros" || r.subbucket === null),
        }
      : bySub("operating_cost", sub)),
  })),
  {
    key: "operating_cost",
    label: BUCKET_LABEL.operating_cost,
    kind: "subtotal",
    depth: 0,
    ...byBucket("operating_cost"),
  },
  {
    key: "unclassified",
    label: BUCKET_LABEL.unclassified,
    kind: "line",
    depth: 0,
    ...byBucket("unclassified"),
  },
  {
    key: "operating_margin",
    label: "Margen operativo",
    kind: "total",
    depth: 0,
    ...anyOf("service_revenue", "operating_cost", "unclassified"),
  },
  {
    key: "financing_cost",
    label: BUCKET_LABEL.financing_cost,
    kind: "line",
    depth: 0,
    ...byBucket("financing_cost"),
  },
  {
    key: "after_financing",
    label: "Resultado después de financiación",
    kind: "total",
    depth: 0,
    ...anyOf(
      "service_revenue",
      "operating_cost",
      "unclassified",
      "financing_cost",
    ),
  },
  {
    key: "loan_principal",
    label: BUCKET_LABEL.loan_principal,
    kind: "line",
    depth: 0,
    ...byBucket("loan_principal"),
  },
  {
    key: "fleet_investment",
    label: BUCKET_LABEL.fleet_investment,
    kind: "line",
    depth: 0,
    ...byBucket("fleet_investment"),
  },
  {
    key: "asset_sale",
    label: BUCKET_LABEL.asset_sale,
    kind: "line",
    depth: 0,
    ...byBucket("asset_sale"),
  },
  {
    key: "employee_advances",
    label: BUCKET_LABEL.employee_advances,
    kind: "line",
    depth: 0,
    ...byBucket("employee_advances"),
  },
  {
    key: "cash_generation",
    label: "Generación de caja",
    kind: "total",
    depth: 0,
    ...anyOf(...CASH_GENERATION_BUCKETS),
  },
  {
    key: "loan_disbursements",
    label: BUCKET_LABEL.loan_disbursements,
    kind: "line",
    depth: 0,
    ...byBucket("loan_disbursements"),
  },
  {
    key: "cash_variation",
    label: "Variación de caja",
    kind: "total",
    depth: 0,
    ...anyOf(...CASH_GENERATION_BUCKETS, "loan_disbursements"),
  },
];

export type SideAmounts = { fiscal: number; internal: number; total: number };

/** amounts[lineKey][month] and the period totals per line, by side. */
export function buildMonthTable(
  rows: readonly ManagementRow[],
  months: readonly string[],
): {
  byMonth: Record<string, Record<string, SideAmounts>>;
  totals: Record<string, SideAmounts>;
} {
  const byMonth: Record<string, Record<string, SideAmounts>> = {};
  const totals: Record<string, SideAmounts> = {};
  for (const line of TABLE_LINES) {
    const matched = rows.filter(line.match);
    byMonth[line.key] = Object.fromEntries(
      months.map((m) => [m, sideAmounts(matched.filter((r) => r.month === m))]),
    );
    totals[line.key] = sideAmounts(
      matched.filter((r) => months.includes(r.month)),
    );
  }
  return { byMonth, totals };
}

function sideAmounts(rows: readonly ManagementRow[]): SideAmounts {
  let fiscal = 0;
  let internal = 0;
  for (const r of rows) {
    if (r.side === "fiscal") fiscal += r.amount;
    else internal += r.amount;
  }
  return {
    fiscal: round2(fiscal),
    internal: round2(internal),
    total: round2(fiscal + internal),
  };
}

/** Result accounts no bucket covers, with their amount in the period. */
export function unclassifiedAccounts(
  rows: readonly ManagementRow[],
): { accountId: string | null; amount: number }[] {
  const map = new Map<string | null, number>();
  for (const r of rows) {
    if (r.bucket !== "unclassified") continue;
    map.set(r.accountId, (map.get(r.accountId) ?? 0) + r.amount);
  }
  return [...map.entries()]
    .map(([accountId, amount]) => ({ accountId, amount: round2(amount) }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

// ---------------------------------------------------------------------------
// Cost centers
// ---------------------------------------------------------------------------

/** Cost-center filter values besides a center's id. */
export const ALL_COST_CENTERS = "all";
export const NO_COST_CENTER = "none";

/** The rows of one cost center ("none": the rows without one; "all": every
 *  row). */
export function filterByCostCenter<T extends { costCenterId: string | null }>(
  rows: readonly T[],
  filter: string,
): T[] {
  if (filter === ALL_COST_CENTERS) return [...rows];
  const target = filter === NO_COST_CENTER ? null : filter;
  return rows.filter((r) => r.costCenterId === target);
}

export type CostCenterResult = {
  costCenterId: string | null;
  waterfall: Waterfall;
};

/** The cascade of each cost center with rows, "sin centro" last; the rest
 *  by operating cost, the largest first. Their sum is the whole cascade. */
export function costCenterBreakdown(
  rows: readonly ManagementRow[],
): CostCenterResult[] {
  const groups = new Map<string | null, ManagementRow[]>();
  for (const r of rows) {
    const list = groups.get(r.costCenterId);
    if (list) list.push(r);
    else groups.set(r.costCenterId, [r]);
  }
  return [...groups.entries()]
    .map(([costCenterId, list]) => ({
      costCenterId,
      waterfall: computeWaterfall(list),
    }))
    .sort((a, b) => {
      if (a.costCenterId === null) return 1;
      if (b.costCenterId === null) return -1;
      return a.waterfall.operatingCost - b.waterfall.operatingCost;
    });
}

// ---------------------------------------------------------------------------
// Payroll control
// ---------------------------------------------------------------------------

export type PayrollControlRow = {
  month: string;
  liquidated: number;
  paidForPeriod: number;
  paidInMonth: number;
  /** Liquidated and not yet paid for that period. */
  unpaid: number;
};

export function toPayrollControlRow(raw: {
  month: string;
  liquidated: number | string;
  paid_for_period: number | string;
  paid_in_month: number | string;
}): PayrollControlRow {
  const liquidated = Number(raw.liquidated);
  const paidForPeriod = Number(raw.paid_for_period);
  return {
    month: raw.month,
    liquidated,
    paidForPeriod,
    paidInMonth: Number(raw.paid_in_month),
    unpaid: round2(liquidated - paidForPeriod),
  };
}

// ---------------------------------------------------------------------------
// Bucket catalog choices (one select)
// ---------------------------------------------------------------------------

export type BucketChoice = {
  value: string;
  label: string;
  bucket: ManagementBucket;
  subbucket: Subbucket | null;
};

export const BUCKET_CHOICES: readonly BucketChoice[] = [
  {
    value: "service_revenue",
    label: BUCKET_LABEL.service_revenue,
    bucket: "service_revenue",
    subbucket: null,
  },
  ...OPERATING_SUBBUCKETS.filter((s) => s !== "sueldos_internos").map(
    (s): BucketChoice => ({
      value: `operating_cost:${s}`,
      label: `${BUCKET_LABEL.operating_cost} › ${SUBBUCKET_LABEL[s]}`,
      bucket: "operating_cost",
      subbucket: s,
    }),
  ),
  ...FINANCING_SUBBUCKETS.map((s): BucketChoice => ({
    value: `financing_cost:${s}`,
    label: `${BUCKET_LABEL.financing_cost} › ${SUBBUCKET_LABEL[s]}`,
    bucket: "financing_cost",
    subbucket: s,
  })),
  ...(
    [
      "loan_principal",
      "fleet_investment",
      "asset_sale",
      "neutral",
      "excluded_noncash",
    ] as const
  ).map((b): BucketChoice => ({
    value: b,
    label: BUCKET_LABEL[b],
    bucket: b,
    subbucket: null,
  })),
];

export function bucketChoiceValue(
  bucket: ManagementBucket,
  subbucket: Subbucket | null,
): string {
  return subbucket ? `${bucket}:${subbucket}` : bucket;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

/** `period` (YYYY-MM) moved `years` years. */
export function shiftPeriod(period: string, years: number): string {
  return `${Number(period.slice(0, 4)) + years}${period.slice(4)}`;
}

export type Kpi = {
  key: "operating_margin_pct" | "operating_result" | "cash_generation";
  label: string;
  /** Percent of services for the margin, pesos for the rest. */
  unit: "pct" | "ars";
  current: number | null;
  /** Same months of the year before; null without data then. */
  previous: number | null;
  /** current − previous (percentage points for the margin). */
  variance: number | null;
};

const percentOf = (part: number, whole: number) =>
  whole === 0 ? null : round2((part / whole) * 100);

/**
 * The KPI row: operating margin over services, the operating result (EBITDA
 * aprox.: the cascade already leaves amortizations and RECPAM out) and cash
 * generation, against the same months of the year before. Only the months
 * up to `currentPeriod` count, so a year in progress compares with the same
 * stretch of the previous one.
 */
export function computeKpis(
  rows: readonly ManagementRow[],
  previousRows: readonly ManagementRow[],
  months: readonly string[],
  currentPeriod: string,
): { months: string[]; kpis: Kpi[] } {
  const elapsed = months.filter((m) => m <= currentPeriod);
  const elapsedSet = new Set(elapsed);
  const previousSet = new Set(elapsed.map((m) => shiftPeriod(m, -1)));
  const cur = computeWaterfall(rows.filter((r) => elapsedSet.has(r.month)));
  const previousInRange = previousRows.filter((r) => previousSet.has(r.month));
  const prev =
    previousInRange.length > 0 ? computeWaterfall(previousInRange) : null;
  const kpi = (
    key: Kpi["key"],
    label: string,
    unit: Kpi["unit"],
    pick: (w: Waterfall) => number | null,
  ): Kpi => {
    const current = pick(cur);
    const previous = prev ? pick(prev) : null;
    return {
      key,
      label,
      unit,
      current,
      previous,
      variance:
        current !== null && previous !== null
          ? round2(current - previous)
          : null,
    };
  };
  return {
    months: elapsed,
    kpis: [
      kpi("operating_margin_pct", "Margen operativo %", "pct", (w) =>
        percentOf(w.operatingMargin, w.serviceRevenue),
      ),
      kpi(
        "operating_result",
        "Resultado operativo (EBITDA aprox.)",
        "ars",
        (w) => w.operatingMargin,
      ),
      kpi(
        "cash_generation",
        "Generación de caja",
        "ars",
        (w) => w.cashGeneration,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Drill-down: the documents behind a figure
// ---------------------------------------------------------------------------

export const DOC_TYPES = [
  "invoice",
  "purchase_invoice",
  "receipt",
  "payment_order",
  "payroll",
  "loan",
  "employee",
  "check",
  "issued_check",
  "transaction",
  "journal_entry",
] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const isDocType = (v: unknown): v is DocType => isOneOf(DOC_TYPES, v);

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  invoice: "Venta",
  purchase_invoice: "Compra",
  receipt: "Recibo",
  payment_order: "Orden de pago",
  payroll: "Sueldos",
  loan: "Préstamo",
  employee: "Cuenta del empleado",
  check: "Cheque de tercero",
  issued_check: "Cheque propio",
  transaction: "Movimiento de tesorería",
  journal_entry: "Asiento manual",
};

/** What a user needs (all of it) to open each kind of document: the gate of
 *  the page the link goes to. */
export const DOC_TYPE_PERMISSIONS: Record<DocType, readonly Permission[]> = {
  invoice: ["invoices:read"],
  purchase_invoice: ["purchase_invoices:read"],
  receipt: ["receipts:read"],
  payment_order: ["payment_orders:read"],
  payroll: ["hr:read"],
  // The gate of /loans/[id].
  loan: TREASURY_PERMISSIONS,
  employee: ["hr:read"],
  check: ["cheques:read"],
  issued_check: ["issued_checks:read"],
  transaction: ["transactions:read"],
  journal_entry: ["accounting:read"],
};

export type ManagementDocument = ManagementRow & {
  docType: DocType;
  docId: string;
  /** YYYY-MM-DD; a payroll period's first day; null for an employee. */
  docDate: string | null;
  label: string;
  counterparty: string | null;
  /** Where the document opens; null when the user cannot open it. */
  href: string | null;
};

export type RawManagementDocument = RawManagementRow & {
  doc_type: string;
  doc_id: string;
  doc_parent_id: string | null;
  doc_subtype: string | null;
  doc_date: string | null;
  doc_label: string | null;
  counterparty: string | null;
};

/** The page a document opens in (before checking the user can open it). */
export function documentHref(
  type: DocType,
  raw: Pick<
    RawManagementDocument,
    "doc_id" | "doc_parent_id" | "doc_subtype" | "doc_date"
  >,
): string | null {
  const id = raw.doc_id;
  switch (type) {
    case "invoice":
      return `/invoices/${id}`;
    case "purchase_invoice":
      return `/purchases/${id}`;
    case "receipt":
      return `/receipts/${id}`;
    case "payment_order":
      return `/payment-orders/${id}`;
    case "payroll":
      return raw.doc_date
        ? payrollPeriodHref(
            Number(raw.doc_date.slice(0, 4)),
            Number(raw.doc_date.slice(5, 7)),
            isPayrollPeriodKind(raw.doc_subtype) ? raw.doc_subtype : "monthly",
          )
        : null;
    case "loan":
      return `/loans/${id}`;
    case "employee":
      return `/employees/${id}`;
    case "check":
      return "/checks";
    case "issued_check":
      return "/issued-checks";
    case "transaction": {
      if (!raw.doc_parent_id) return "/transactions";
      const params = new URLSearchParams({ account: raw.doc_parent_id });
      if (raw.doc_date) {
        params.set("period", "custom");
        params.set("from", raw.doc_date);
        params.set("to", raw.doc_date);
      }
      return `/transactions?${params.toString()}`;
    }
    case "journal_entry":
      return "/accounting/journal";
  }
}

/** Narrows the drill-down rows; `canOpen` decides whether each gets a link.
 *  A row of an unknown kind comes back apart (logged, never dropped). */
export function narrowManagementDocuments(
  raw: readonly RawManagementDocument[],
  canOpen: (type: DocType) => boolean,
): { docs: ManagementDocument[]; unknown: RawManagementDocument[] } {
  const docs: ManagementDocument[] = [];
  const unknown: RawManagementDocument[] = [];
  for (const r of raw) {
    const [row] = narrowManagementRows([r]).rows;
    if (!row || !isDocType(r.doc_type)) {
      unknown.push(r);
      continue;
    }
    const type = r.doc_type;
    docs.push({
      ...row,
      docType: type,
      docId: r.doc_id,
      docDate: r.doc_date,
      label: r.doc_label ?? DOC_TYPE_LABEL[type],
      counterparty: r.counterparty,
      href: canOpen(type) ? documentHref(type, r) : null,
    });
  }
  return { docs, unknown };
}

/** The most documents a drill-down returns (the largest first). */
export const DRILL_LIMIT = 500;

export const SIDE_VIEWS = ["total", "fiscal", "internal"] as const;
export type SideView = (typeof SIDE_VIEWS)[number];
export const isSideView = (v: unknown): v is SideView => isOneOf(SIDE_VIEWS, v);

export const ManagementDrillInputSchema = z
  .object({
    fromPeriod: PeriodSchema,
    toPeriod: PeriodSchema,
    basis: z.enum(MANAGEMENT_BASES),
    lineKey: z
      .string()
      .refine(
        (k) => TABLE_LINES.some((l) => l.key === k),
        "Línea desconocida.",
      ),
    side: z.enum(SIDE_VIEWS).default("total"),
    costCenter: z
      .union([
        z.string().uuid(),
        z.literal(ALL_COST_CENTERS),
        z.literal(NO_COST_CENTER),
      ])
      .default(ALL_COST_CENTERS),
  })
  .refine((v) => v.fromPeriod <= v.toPeriod, {
    message: "El período desde no puede ser posterior al hasta.",
  });
export type ManagementDrillInput = z.input<typeof ManagementDrillInputSchema>;

/** The buckets a table line reads (what the drill-down asks the RPC for). */
export function lineBuckets(lineKey: string): readonly RowBucket[] {
  return TABLE_LINES.find((l) => l.key === lineKey)?.buckets ?? [];
}

export type ManagementDrill = {
  /** Up to DRILL_LIMIT documents, the largest first. */
  documents: ManagementDocument[];
  /** How many documents the figure has, and what they add up to. */
  count: number;
  total: number;
  pendingUsd: number;
  /** The read stopped at its cap: there are more documents than counted. */
  partial: boolean;
};

/** The documents of one table line, side and cost center, the largest
 *  first, capped at `limit`; `total` adds up all of them (the figure). */
export function drillDocuments(
  docs: readonly ManagementDocument[],
  input: { lineKey: string; side: SideView; costCenter: string },
  limit = DRILL_LIMIT,
): ManagementDrill {
  const line = TABLE_LINES.find((l) => l.key === input.lineKey);
  const matched = filterByCostCenter(
    line ? docs.filter(line.match) : [],
    input.costCenter,
  ).filter((d) => input.side === "total" || d.side === input.side);
  // One row per document, month and side (a document can touch several
  // accounts or centers of the same line).
  const byDoc = new Map<string, ManagementDocument>();
  for (const d of matched) {
    const key = `${d.docType}:${d.docId}:${d.month}:${d.side}`;
    const seen = byDoc.get(key);
    byDoc.set(
      key,
      seen
        ? {
            ...seen,
            amount: round2(seen.amount + d.amount),
            pendingUsd: round2(seen.pendingUsd + d.pendingUsd),
          }
        : d,
    );
  }
  const kept = [...byDoc.values()];
  const sorted = [...kept].sort(
    (a, b) =>
      Math.abs(b.amount) - Math.abs(a.amount) ||
      a.month.localeCompare(b.month) ||
      a.docId.localeCompare(b.docId),
  );
  return {
    documents: sorted.slice(0, limit),
    count: kept.length,
    total: round2(kept.reduce((a, d) => a + d.amount, 0)),
    pendingUsd: round2(kept.reduce((a, d) => a + d.pendingUsd, 0)),
    partial: false,
  };
}

// ---------------------------------------------------------------------------
// Export (internal use)
// ---------------------------------------------------------------------------

export const INTERNAL_USE_NOTICE =
  "Uso interno (fiscal + interno). No es el EERR fiscal: no presentar a bancos, ARCA ni terceros.";

export const MANAGEMENT_EXPORT_FORMATS = ["csv", "xlsx"] as const;

/** What the audit records of a download. */
export const ManagementExportInputSchema = ManagementReportInputSchema.extend({
  format: z.enum(MANAGEMENT_EXPORT_FORMATS),
  side: z.enum(SIDE_VIEWS),
  costCenter: z.string().min(1).max(64),
});
export type ManagementExportInput = z.infer<typeof ManagementExportInputSchema>;

/** The month table as rows: concept, each month on `side`, and the period
 *  totals by side. The same figures as the screen. */
export function monthTableExport(
  table: ReturnType<typeof buildMonthTable>,
  months: readonly string[],
  side: SideView,
): { header: string[]; rows: CsvCell[][] } {
  return {
    header: ["Concepto", ...months, "Fiscal", "Interno", "Total"],
    rows: TABLE_LINES.map((line) => {
      const totals = table.totals[line.key]!;
      return [
        `${"  ".repeat(line.depth)}${line.label}`,
        ...months.map((m) => table.byMonth[line.key]![m]![side]),
        totals.fiscal,
        totals.internal,
        totals.total,
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// Margin per truck (get_vehicle_margin)
// ---------------------------------------------------------------------------

/** 'vehicle' is a truck; the rest is what no truck owns, shown apart. */
export const VEHICLE_MARGIN_KINDS = [
  "vehicle",
  "no_vehicle",
  "unlinked_center",
  "no_center",
] as const;
export type VehicleMarginKind = (typeof VEHICLE_MARGIN_KINDS)[number];
export const isVehicleMarginKind = (v: unknown): v is VehicleMarginKind =>
  isOneOf(VEHICLE_MARGIN_KINDS, v);

export const VehicleMarginInputSchema = z
  .object({ fromPeriod: PeriodSchema, toPeriod: PeriodSchema })
  .refine((v) => v.fromPeriod <= v.toPeriod, {
    message: "El período desde no puede ser posterior al hasta.",
  });
export type VehicleMarginInput = z.infer<typeof VehicleMarginInputSchema>;

export type RawVehicleMarginRow = {
  row_kind: string;
  vehicle_id: string | null;
  patente: string | null;
  is_active: boolean | null;
  cost_center_id: string | null;
  trips: number;
  revenue: number | string;
  trip_cost: number | string;
  fuel_cost: number | string;
  maintenance_cost: number | string;
  center_cost: number | string;
  net: number | string;
  pending_usd: number | string;
  maintenance_without_cost: number;
  uninvoiced_shipments: number;
};

/** Costs are positive amounts; net = revenue − every cost. */
export type VehicleMarginRow = {
  kind: VehicleMarginKind;
  vehicleId: string | null;
  patente: string | null;
  isActive: boolean | null;
  costCenterId: string | null;
  trips: number;
  revenue: number;
  tripCost: number;
  fuelCost: number;
  maintenanceCost: number;
  /** Services with no cost typed: unknown, not in maintenanceCost. */
  maintenanceWithoutCost: number;
  /** Operating cost loaded with the truck's cost center (apart: with a
   *  center no truck owns, or without a center). */
  centerCost: number;
  net: number;
  /** null without revenue. */
  marginPct: number | null;
  /** USD without a rate of the center, signed (never summed). */
  pendingUsd: number;
  /** Cargas of its trips still to invoice (a tariff-priced one has no
   *  freight yet): not in revenue, so with any the net is not final. */
  uninvoicedShipments: number;
};

export type VehicleMargin = {
  /** Trucks, best net first. */
  vehicles: VehicleMarginRow[];
  /** Trips without a vehicle (revenue and trip cost), if any. */
  withoutVehicle: VehicleMarginRow | null;
  /** Operating cost no truck owns: per center without a truck, and the one
   *  without a center. Never spread across trucks. */
  unattributed: VehicleMarginRow[];
  /** The read reached its cap: some rows may be missing. */
  partial: boolean;
};

function marginPct(net: number, revenue: number): number | null {
  return revenue === 0 ? null : Math.round((net / revenue) * 1000) / 10;
}

/** Narrows the RPC rows; a row of an unknown kind comes back apart so the
 *  caller logs it. */
export function narrowVehicleMargin(raw: readonly RawVehicleMarginRow[]): {
  rows: VehicleMarginRow[];
  unknown: RawVehicleMarginRow[];
} {
  const rows: VehicleMarginRow[] = [];
  const unknown: RawVehicleMarginRow[] = [];
  for (const r of raw) {
    if (!isVehicleMarginKind(r.row_kind)) {
      unknown.push(r);
      continue;
    }
    const revenue = Number(r.revenue);
    const net = Number(r.net);
    rows.push({
      kind: r.row_kind,
      vehicleId: r.vehicle_id,
      patente: r.patente,
      isActive: r.is_active,
      costCenterId: r.cost_center_id,
      trips: Number(r.trips),
      revenue,
      tripCost: Number(r.trip_cost),
      fuelCost: Number(r.fuel_cost),
      maintenanceCost: Number(r.maintenance_cost),
      maintenanceWithoutCost: Number(r.maintenance_without_cost),
      centerCost: Number(r.center_cost),
      net,
      marginPct: marginPct(net, revenue),
      pendingUsd: Number(r.pending_usd),
      uninvoicedShipments: Number(r.uninvoiced_shipments),
    });
  }
  return { rows, unknown };
}

/** The screen's grouping of the narrowed rows. */
export function groupVehicleMargin(
  rows: readonly VehicleMarginRow[],
  partial: boolean,
): VehicleMargin {
  return {
    vehicles: rows
      .filter((r) => r.kind === "vehicle")
      .sort(
        (a, b) =>
          b.net - a.net || (a.patente ?? "").localeCompare(b.patente ?? ""),
      ),
    withoutVehicle: rows.find((r) => r.kind === "no_vehicle") ?? null,
    unattributed: rows
      .filter((r) => r.kind === "unlinked_center" || r.kind === "no_center")
      .sort((a, b) => b.centerCost - a.centerCost),
    partial,
  };
}
