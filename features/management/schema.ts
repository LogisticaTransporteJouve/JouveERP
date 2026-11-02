// Resultado de gestión (roadmap 1.0): an internal view of whether the
// operation makes money, fiscal + internal. Never for third parties: the
// fiscal books (EERR, Balance, Libro IVA) are the accountant's.

import { z } from "zod";

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
 *  RPC drops), a result account without mapping, and USD without a rate. */
export const ROW_BUCKETS = [
  ...MANAGEMENT_BUCKETS.filter((b) => b !== "neutral"),
  "unclassified",
  "pending_usd",
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
};

export type RawManagementRow = {
  month: string;
  bucket: string;
  subbucket: string | null;
  channel_side: string;
  chart_account_id: string | null;
  amount_ars: number | string;
  pending_usd: number | string;
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
    });
  }
  return { rows, unknown };
}

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
  cashGeneration: number;
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
    cashGeneration: round2(
      afterFinancing + loanPrincipal + fleetInvestment + assetSale,
    ),
    excludedNoncash: sum("excluded_noncash"),
    pendingUsd: round2(rows.reduce((a, r) => a + r.pendingUsd, 0)),
  };
}

// ---------------------------------------------------------------------------
// Month table
// ---------------------------------------------------------------------------

export type LineKind = "line" | "subtotal" | "total";

export type TableLine = {
  key: string;
  label: string;
  kind: LineKind;
  /** Nesting under a heading (0 = top). */
  depth: number;
  match: (r: ManagementRow) => boolean;
};

const byBucket = (bucket: RowBucket) => (r: ManagementRow) =>
  r.bucket === bucket;
const bySub = (bucket: RowBucket, sub: Subbucket) => (r: ManagementRow) =>
  r.bucket === bucket && r.subbucket === sub;
const anyOf =
  (...buckets: RowBucket[]) =>
  (r: ManagementRow) =>
    buckets.includes(r.bucket);

const OPERATING_DETAIL = OPERATING_SUBBUCKETS.filter(
  (s) => s !== "sueldos" && s !== "sueldos_internos",
);

/** The lines of the month table, top to bottom. */
export const TABLE_LINES: readonly TableLine[] = [
  {
    key: "service_revenue",
    label: BUCKET_LABEL.service_revenue,
    kind: "line",
    depth: 0,
    match: byBucket("service_revenue"),
  },
  {
    key: "op:sueldos",
    label: SUBBUCKET_LABEL.sueldos,
    kind: "line",
    depth: 2,
    match: bySub("operating_cost", "sueldos"),
  },
  {
    key: "op:sueldos_internos",
    label: SUBBUCKET_LABEL.sueldos_internos,
    kind: "line",
    depth: 2,
    match: bySub("operating_cost", "sueldos_internos"),
  },
  {
    key: "op:personal",
    label: "Total personal",
    kind: "subtotal",
    depth: 1,
    match: (r) =>
      r.bucket === "operating_cost" &&
      (r.subbucket === "sueldos" || r.subbucket === "sueldos_internos"),
  },
  ...OPERATING_DETAIL.map((sub): TableLine => ({
    key: `op:${sub}`,
    label: SUBBUCKET_LABEL[sub],
    kind: "line",
    depth: 1,
    match:
      sub === "otros"
        ? (r) =>
            r.bucket === "operating_cost" &&
            (r.subbucket === "otros" || r.subbucket === null)
        : bySub("operating_cost", sub),
  })),
  {
    key: "operating_cost",
    label: BUCKET_LABEL.operating_cost,
    kind: "subtotal",
    depth: 0,
    match: byBucket("operating_cost"),
  },
  {
    key: "unclassified",
    label: BUCKET_LABEL.unclassified,
    kind: "line",
    depth: 0,
    match: byBucket("unclassified"),
  },
  {
    key: "operating_margin",
    label: "Margen operativo",
    kind: "total",
    depth: 0,
    match: anyOf("service_revenue", "operating_cost", "unclassified"),
  },
  {
    key: "financing_cost",
    label: BUCKET_LABEL.financing_cost,
    kind: "line",
    depth: 0,
    match: byBucket("financing_cost"),
  },
  {
    key: "after_financing",
    label: "Resultado después de financiación",
    kind: "total",
    depth: 0,
    match: anyOf(
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
    match: byBucket("loan_principal"),
  },
  {
    key: "fleet_investment",
    label: BUCKET_LABEL.fleet_investment,
    kind: "line",
    depth: 0,
    match: byBucket("fleet_investment"),
  },
  {
    key: "asset_sale",
    label: BUCKET_LABEL.asset_sale,
    kind: "line",
    depth: 0,
    match: byBucket("asset_sale"),
  },
  {
    key: "cash_generation",
    label: "Generación de caja",
    kind: "total",
    depth: 0,
    match: anyOf(
      "service_revenue",
      "operating_cost",
      "unclassified",
      "financing_cost",
      "loan_principal",
      "fleet_investment",
      "asset_sale",
    ),
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
