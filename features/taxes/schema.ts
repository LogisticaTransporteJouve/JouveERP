import { z } from "zod";

import { formatPeriod, round2 } from "@/lib/format";
import {
  IsoDateSchema,
  PeriodSchema,
  UuidSchema,
} from "@/lib/validation/common";

// Impuestos como documento (roadmap 6.6). Mirrors public.tax_documents:
// the kinds and statuses are its CHECK lists.

export const TAX_KINDS = [
  "iva",
  "iibb",
  "ganancias_anticipo",
  "sicore",
  "cargas_sociales",
  "monotributo",
  "otro",
] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export const TAX_KIND_LABEL: Record<TaxKind, string> = {
  iva: "IVA (posición mensual)",
  iibb: "Ingresos Brutos",
  ganancias_anticipo: "Anticipo de Ganancias",
  sicore: "SICORE (retenciones y percepciones)",
  cargas_sociales: "Cargas sociales (F931)",
  monotributo: "Monotributo",
  otro: "Otro",
};

/** Short name used in tables, the calendar and the payment description;
 *  the SQL twin is public.tax_document_label. */
const TAX_KIND_SHORT: Record<TaxKind, string> = {
  iva: "IVA",
  iibb: "IIBB",
  ganancias_anticipo: "Anticipo de Ganancias",
  sicore: "SICORE",
  cargas_sociales: "Cargas sociales (F931)",
  monotributo: "Monotributo",
  otro: "Otro",
};

export const TAX_STATUSES = [
  "pendiente",
  "liquidado",
  "pagado",
  "anulado",
] as const;
export type TaxStatus = (typeof TAX_STATUSES)[number];

export const TAX_STATUS_LABEL: Record<TaxStatus, string> = {
  pendiente: "Pendiente",
  liquidado: "Liquidado",
  pagado: "Pagado",
  anulado: "Anulado",
};

/** The chart-of-accounts system role suggested as the account a kind's
 *  payment debits, when the plan has it. */
export const TAX_KIND_DEFAULT_ROLE: Partial<Record<TaxKind, string>> = {
  iva: "iva_debito",
  sicore: "retenciones_cobradas",
};

export function isTaxKind(value: string): value is TaxKind {
  return (TAX_KINDS as readonly string[]).includes(value);
}

export function isTaxStatus(value: string): value is TaxStatus {
  return (TAX_STATUSES as readonly string[]).includes(value);
}

export type TaxDocument = {
  id: string;
  kind: TaxKind;
  title: string | null;
  jurisdiction: string | null;
  period: string;
  due_date: string;
  amount: number | null;
  amount_is_estimate: boolean;
  status: TaxStatus;
  account_id: string | null;
  account_name: string | null;
  payment_transaction_id: string | null;
  paid_date: string | null;
  paid_amount: number | null;
  /** The cash or bank account it was paid from; null when the viewer cannot
   *  read treasury movements. */
  paid_from: string | null;
  notes: string | null;
};

/** "IVA", "IIBB (Buenos Aires)", or the title of an "otro". */
export function taxDocumentLabel(doc: {
  kind: TaxKind;
  title: string | null;
  jurisdiction: string | null;
}): string {
  const base =
    doc.kind === "otro" && doc.title ? doc.title : TAX_KIND_SHORT[doc.kind];
  return doc.jurisdiction ? `${base} (${doc.jurisdiction})` : base;
}

/** Open = still to be paid. */
export function isOpenTaxStatus(status: TaxStatus): boolean {
  return status === "pendiente" || status === "liquidado";
}

/** An open document whose due date is before `today` (YYYY-MM-DD). */
export function isTaxDocumentOverdue(
  doc: { status: TaxStatus; due_date: string },
  today: string,
): boolean {
  return isOpenTaxStatus(doc.status) && doc.due_date < today;
}

export function taxPeriodLabel(period: string): string {
  return formatPeriod(period);
}

/** "2026-11" → "2026-10". */
export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The same calendar day one month later, clamped to the month's last day
 *  ("2026-01-31" → "2026-02-28"). */
export function addOneMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máx ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const TaxDocumentFields = z.object({
  kind: z.enum(TAX_KINDS),
  title: optionalText(120),
  jurisdiction: optionalText(60),
  period: PeriodSchema,
  due_date: IsoDateSchema,
  amount: z
    .number()
    .finite()
    .positive("El importe tiene que ser mayor a cero.")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  amount_is_estimate: z.boolean().optional().default(false),
  account_id: UuidSchema.nullable()
    .optional()
    .transform((v) => v ?? null),
  notes: optionalText(1000),
});

function refineDocument(
  doc: z.infer<typeof TaxDocumentFields>,
  ctx: z.RefinementCtx,
) {
  if (doc.kind === "otro" && !doc.title) {
    ctx.addIssue({
      code: "custom",
      path: ["title"],
      message: "Poné el nombre del impuesto.",
    });
  }
  if (doc.amount_is_estimate && doc.amount === null) {
    ctx.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Un importe estimado necesita el importe.",
    });
  }
}

export const TaxDocumentCreateSchema =
  TaxDocumentFields.superRefine(refineDocument);
export type TaxDocumentCreateInput = z.input<typeof TaxDocumentCreateSchema>;

export const TaxDocumentUpdateSchema = TaxDocumentFields.extend({
  id: UuidSchema,
}).superRefine(refineDocument);
export type TaxDocumentUpdateInput = z.input<typeof TaxDocumentUpdateSchema>;

/** The transitions a user makes by hand; "pagado" goes through payment. */
export const TaxStatusChangeSchema = z.object({
  id: UuidSchema,
  status: z.enum(["pendiente", "liquidado", "anulado"]),
});

export const PayTaxDocumentSchema = z.object({
  id: UuidSchema,
  paid_date: IsoDateSchema,
  account_id: UuidSchema,
  amount: z
    .number()
    .finite()
    .positive("El importe tiene que ser mayor a cero."),
});

export const CopyTaxPeriodSchema = z.object({ period: PeriodSchema });

// ─── Paying with a movement already loaded ──────────────────────────────────

/** Days around the due date a movement is offered as the payment. */
export const LINK_CANDIDATE_DAY_WINDOW = 15;
export const LINK_CANDIDATES_PAGE_SIZE = 20;

export const TaxPaymentCandidatesSchema = z.object({
  id: UuidSchema,
  page: z.number().int().min(0).max(500).optional().default(0),
});

/** link_tax_document_payment: another amount than the document's is linked
 *  only when the user confirms it. */
export const LinkTaxPaymentSchema = z.object({
  id: UuidSchema,
  transaction_id: UuidSchema,
  allow_difference: z.boolean().optional().default(false),
});
export type LinkTaxPaymentInput = z.input<typeof LinkTaxPaymentSchema>;

/** A loose expense of a cash or bank account in pesos, fiscal channel. */
export type TaxPaymentCandidate = {
  id: string;
  transaction_date: string;
  amount: number;
  description: string | null;
  account_name: string;
  /** movement − document; null when the document has no amount yet. */
  difference: number | null;
  /** Days from the due date (negative = before it). */
  days_from_due: number;
};

export type TaxPaymentCandidatesPage = {
  items: TaxPaymentCandidate[];
  total: number;
  page: number;
  page_size: number;
};

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Closest amount first, then closest to the due date, then by id. */
export function rankTaxPaymentCandidates(
  rows: readonly Omit<TaxPaymentCandidate, "difference" | "days_from_due">[],
  doc: { amount: number | null; due_date: string },
): TaxPaymentCandidate[] {
  return rows
    .map((r) => ({
      ...r,
      difference: doc.amount === null ? null : round2(r.amount - doc.amount),
      days_from_due: daysBetween(doc.due_date, r.transaction_date),
    }))
    .sort(
      (a, b) =>
        Math.abs(a.difference ?? 0) - Math.abs(b.difference ?? 0) ||
        Math.abs(a.days_from_due) - Math.abs(b.days_from_due) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** An open document with its account set: what a statement debit can pay. */
export type PayableTaxDocument = {
  id: string;
  label: string;
  period: string;
  due_date: string;
  amount: number | null;
};

export const TaxListSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

// ─── IVA estimate ───────────────────────────────────────────────────────────

/** IVA position of a period from the libro IVA: débito − crédito −
 *  retenciones y percepciones de IVA sufridas en cobranzas. Every figure in
 *  pesos, NC already subtracted. An estimate: the DDJJ in ARCA is the one
 *  that counts. */
export type IvaPositionEstimate = {
  period: string;
  debito: number;
  credito: number;
  retenciones: number;
  /** debito − credito − retenciones; negative = saldo a favor. */
  saldo: number;
  ventas: number;
  compras: number;
};

export function computeIvaPosition(input: {
  period: string;
  debito: number;
  credito: number;
  retenciones: number;
  ventas: number;
  compras: number;
}): IvaPositionEstimate {
  const debito = round2(input.debito);
  const credito = round2(input.credito);
  const retenciones = round2(input.retenciones);
  return {
    period: input.period,
    debito,
    credito,
    retenciones,
    saldo: round2(debito - credito - retenciones),
    ventas: input.ventas,
    compras: input.compras,
  };
}

/** Σ IVA of a libro IVA totals' per-rate map. */
export function sumIva(
  perRate: Record<number, { neto: number; iva: number }>,
): number {
  return Object.values(perRate).reduce((acc, r) => acc + r.iva, 0);
}

// ─── Calendar ───────────────────────────────────────────────────────────────

/** The weeks (Monday first) of the month of `month` (YYYY-MM), each day as
 *  YYYY-MM-DD or null outside the month. */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) {
    cells.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "2026-11" ± n months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
