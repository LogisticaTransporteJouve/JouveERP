import { z } from "zod";

import type { ContributorInfo, FiscalAddress } from "@/lib/afip/types";
import type { Permission } from "@/lib/auth/permissions";

import type { IvaCondition } from "@/features/clients/schema";

import type { PurchaseInvoiceKind, PurchaseInvoiceLetter } from "../schema";

// Pure rules of «Aceptar todos los pendientes» (Compras › Recibidos de ARCA):
// the order vouchers load in, the supplier a CUIT is created as, an NC/ND's
// origin, the dollar rate and the run's result. The job that applies them is
// lib/purchases/arca-bulk-accept.ts.

/** Who may run it: the owner (opening balances are owner-only) with Compras
 *  and Proveedores write. */
export const ARCA_BULK_ACCEPT_PERMISSIONS = [
  "opening_balances:write",
  "purchase_invoices:write",
  "suppliers:write",
] as const satisfies readonly Permission[];

/** Everything up to this date is settled by an opening balance at 0; what
 *  comes after stays as open debt. */
export const BULK_OPENING_DATE = "2026-10-31";

/** A run with no end older than this died without its failure handler: it no
 *  longer blocks a new one. */
export const BULK_STALE_RUN_MS = 8 * 60 * 60 * 1000;

/** How many errors the result keeps (the rest are only counted). */
export const BULK_MAX_ERRORS = 200;

/** A rate loaded this many days before the voucher's date still applies
 *  (weekends, holidays); an older one is not that day's rate. */
export const BULK_RATE_MAX_AGE_DAYS = 7;

export const BULK_PENDING_REASONS = [
  "nc_nd_sin_origen",
  "sin_cotizacion",
  "sin_proveedor",
  "sin_canal",
  "tributos_sin_reparto",
  "error",
] as const;
export type BulkPendingReason = (typeof BULK_PENDING_REASONS)[number];

export const BULK_PENDING_REASON_LABEL: Record<BulkPendingReason, string> = {
  nc_nd_sin_origen: "NC/ND sin factura de origen",
  sin_cotizacion: "en dólares sin cotización",
  sin_proveedor: "sin proveedor",
  sin_canal: "sin canal fiscal",
  tributos_sin_reparto: "otros tributos sin reparto",
  error: "con error",
};

export const BULK_PHASES = [
  "queued",
  "suppliers",
  "vouchers",
  "opening_balances",
  "done",
  "failed",
] as const;
export type BulkPhase = (typeof BULK_PHASES)[number];

/** A run as the tray shows it. */
export type BulkRun = {
  id: string;
  phase: BulkPhase;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: BulkProgress;
  error: string | null;
};

const count = z.number().int().nonnegative().catch(0);

export const BulkProgressSchema = z.object({
  totals: z
    .object({ vouchers: count, newSuppliers: count })
    .catch({ vouchers: 0, newSuppliers: 0 }),
  suppliers: z
    .object({
      created: count,
      existing: count,
      fromPadron: count,
      fallback: count,
      failed: count,
    })
    .catch({ created: 0, existing: 0, fromPadron: 0, fallback: 0, failed: 0 }),
  vouchers: z
    .object({
      accepted: count,
      linked: count,
      alreadyProcessed: count,
      pending: z
        .object({
          nc_nd_sin_origen: count,
          sin_cotizacion: count,
          sin_proveedor: count,
          sin_canal: count,
          tributos_sin_reparto: count,
          error: count,
        } satisfies Record<BulkPendingReason, typeof count>)
        .catch(emptyPending()),
    })
    .catch({
      accepted: 0,
      linked: 0,
      alreadyProcessed: 0,
      pending: emptyPending(),
    }),
  openingBalances: z
    .object({ applied: count, failed: count })
    .catch({ applied: 0, failed: 0 }),
  /** Dollar purchases dated up to the opening date: the opening balance
   *  settles pesos only, so they stay open. */
  dolOpen: count,
  errors: z
    .array(
      z.object({
        scope: z.enum(["supplier", "voucher", "opening"]),
        ref: z.string(),
        message: z.string(),
      }),
    )
    .catch([]),
});
export type BulkProgress = z.infer<typeof BulkProgressSchema>;
export type BulkError = BulkProgress["errors"][number];

function emptyPending(): Record<BulkPendingReason, number> {
  return {
    nc_nd_sin_origen: 0,
    sin_cotizacion: 0,
    sin_proveedor: 0,
    sin_canal: 0,
    tributos_sin_reparto: 0,
    error: 0,
  };
}

export function emptyBulkProgress(): BulkProgress {
  return BulkProgressSchema.parse({});
}

/** What one chunk adds to the run. Every count is a delta. */
export type BulkDelta = {
  suppliers?: Partial<BulkProgress["suppliers"]>;
  vouchers?: Partial<Omit<BulkProgress["vouchers"], "pending">> & {
    pending?: Partial<Record<BulkPendingReason, number>>;
  };
  openingBalances?: Partial<BulkProgress["openingBalances"]>;
  dolOpen?: number;
  errors?: BulkError[];
};

function addCounts<K extends string>(
  a: Record<K, number>,
  b: Partial<Record<K, number>> | undefined,
): Record<K, number> {
  const out = { ...a };
  if (!b) return out;
  for (const k of Object.keys(a).filter((k): k is K => k in b)) {
    out[k] += b[k] ?? 0;
  }
  return out;
}

export function mergeBulkProgress(
  acc: BulkProgress,
  delta: BulkDelta,
): BulkProgress {
  const { pending, ...voucherCounts } = delta.vouchers ?? {};
  const { pending: accPending, ...accVouchers } = acc.vouchers;
  return {
    totals: acc.totals,
    suppliers: addCounts(acc.suppliers, delta.suppliers),
    vouchers: {
      ...addCounts(accVouchers, voucherCounts),
      pending: addCounts(accPending, pending),
    },
    openingBalances: addCounts(acc.openingBalances, delta.openingBalances),
    dolOpen: acc.dolOpen + (delta.dolOpen ?? 0),
    errors: [...acc.errors, ...(delta.errors ?? [])].slice(0, BULK_MAX_ERRORS),
  };
}

/** Pending vouchers left behind, over every reason. */
export function bulkPendingTotal(p: BulkProgress): number {
  return BULK_PENDING_REASONS.reduce((n, r) => n + p.vouchers.pending[r], 0);
}

// ─── Order ───────────────────────────────────────────────────────────────────

const KIND_ORDER: Record<PurchaseInvoiceKind, number> = {
  factura: 0,
  nd: 1,
  nc: 2,
};

/** Facturas first, then ND, then NC (so a note's origin is loaded before
 *  it), each by date, point of sale and number. */
export function bulkAcceptOrder<
  T extends {
    kind: PurchaseInvoiceKind | null;
    fecha: string;
    punto_venta: number;
    numero: number;
  },
>(vouchers: readonly T[]): T[] {
  return [...vouchers].sort(
    (a, b) =>
      KIND_ORDER[a.kind ?? "factura"] - KIND_ORDER[b.kind ?? "factura"] ||
      a.fecha.localeCompare(b.fecha) ||
      a.punto_venta - b.punto_venta ||
      a.numero - b.numero,
  );
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

export type MissingSupplier = {
  cuit: string;
  issuerName: string;
  /** The letters it issued us: the IVA condition when padrón does not say. */
  letters: PurchaseInvoiceLetter[];
};

/** One entry per CUIT among vouchers whose issuer has no fiscal supplier. */
export function missingSuppliers(
  vouchers: readonly {
    issuer_cuit: string;
    issuer_name: string;
    letter: PurchaseInvoiceLetter | null;
  }[],
  known: ReadonlySet<string>,
): MissingSupplier[] {
  const byCuit = new Map<string, MissingSupplier>();
  for (const v of vouchers) {
    if (known.has(v.issuer_cuit)) continue;
    const entry = byCuit.get(v.issuer_cuit) ?? {
      cuit: v.issuer_cuit,
      issuerName: v.issuer_name,
      letters: [],
    };
    if (!entry.issuerName.trim() && v.issuer_name.trim()) {
      entry.issuerName = v.issuer_name;
    }
    if (v.letter && !entry.letters.includes(v.letter)) {
      entry.letters.push(v.letter);
    }
    byCuit.set(v.issuer_cuit, entry);
  }
  return [...byCuit.values()].sort((a, b) => a.cuit.localeCompare(b.cuit));
}

/** Who issues an A or a B is responsable inscripto; only a C, monotributo. */
export function ivaConditionFromLetters(
  letters: readonly PurchaseInvoiceLetter[],
): IvaCondition {
  if (letters.includes("A") || letters.includes("B")) {
    return "responsable_inscripto";
  }
  return letters.includes("C") ? "monotributo" : "no_categorizado";
}

export function formatFiscalAddress(a: FiscalAddress | null): string | null {
  if (!a) return null;
  const place = [a.street, a.city, a.province]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  const cp = a.postal_code.trim();
  const text = cp ? `${place}${place ? " " : ""}(CP ${cp})` : place;
  return text || null;
}

const LEGAL_NAME_MAX = 120;

function legalName(...names: (string | null | undefined)[]): string | null {
  for (const n of names) {
    const t = (n ?? "").trim().replace(/\s+/g, " ");
    if (t.length >= 2) return t.slice(0, LEGAL_NAME_MAX).trim();
  }
  return null;
}

export type PadronAnswer =
  | {
      kind: "found";
      info: Pick<
        ContributorInfo,
        "legal_name" | "tax_condition" | "fiscal_address"
      >;
    }
  | { kind: "failed"; legalName: string | null };

/** The fiscal supplier a CUIT is created as: padrón's name, IVA condition
 *  and fiscal address; without a constancia, the name AFIP still gave (or
 *  ARCA's issuer name) and the condition its letters imply. */
export function supplierFromPadron(
  missing: MissingSupplier,
  padron: PadronAnswer,
): {
  input: {
    is_fiscal: true;
    cuit: string;
    legal_name: string;
    iva_condition: IvaCondition;
    address: string | null;
  };
  fromPadron: boolean;
} {
  const fallbackName = `Proveedor ${missing.cuit}`;
  if (padron.kind === "found") {
    return {
      input: {
        is_fiscal: true,
        cuit: missing.cuit,
        legal_name:
          legalName(padron.info.legal_name, missing.issuerName) ?? fallbackName,
        iva_condition: padron.info.tax_condition,
        address: formatFiscalAddress(padron.info.fiscal_address),
      },
      fromPadron: true,
    };
  }
  return {
    input: {
      is_fiscal: true,
      cuit: missing.cuit,
      legal_name:
        legalName(padron.legalName, missing.issuerName) ?? fallbackName,
      iva_condition: ivaConditionFromLetters(missing.letters),
      address: null,
    },
    fromPadron: false,
  };
}

// ─── Channel, rate and origin ────────────────────────────────────────────────

/** The supplier's default channel when it is an active fiscal one (a
 *  segregated one included: a DZ supplier's vouchers go to DZ), else the only
 *  active fiscal channel of the main app; null when that is not one. */
export function pickBulkChannel(
  channels: readonly {
    id: string;
    is_fiscal: boolean;
    is_active: boolean;
    is_segregated?: boolean;
  }[],
  defaultChannelId: string | null,
): string | null {
  const fiscal = channels.filter((c) => c.is_active && c.is_fiscal);
  const usual = fiscal.find((c) => c.id === defaultChannelId);
  if (usual) return usual.id;
  const main = fiscal.filter((c) => c.is_segregated !== true);
  const [only] = main;
  return only && main.length === 1 ? only.id : null;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Pesos per dollar for a voucher: 1 in pesos; ARCA's own when above 1;
 *  else the official rate loaded for its date (or a few days before). Null
 *  when there is none. */
export function pickBulkCotizacion(
  voucher: { moneda: "PES" | "DOL"; cotizacion: number | null; fecha: string },
  rate: { rate: number; rate_date: string } | null,
): number | null {
  if (voucher.moneda === "PES") return 1;
  if (voucher.cotizacion !== null && voucher.cotizacion > 1) {
    return voucher.cotizacion;
  }
  if (!rate || !(rate.rate > 1)) return null;
  const age = daysBetween(rate.rate_date, voucher.fecha);
  return age >= 0 && age <= BULK_RATE_MAX_AGE_DAYS ? rate.rate : null;
}

export type OriginCandidate = {
  id: string;
  fecha: string;
  imp_total: number;
  /** What it owes by itself: what payments and its own NCs leave open
   *  (own_open_amount; credit other NCs spill on it does not count). */
  open_amount: number;
};

const cents = (n: number) => Math.round(n * 100);

/**
 * An NC/ND's origin among the supplier's facturas of the same letter and
 * currency dated on or before it: the one with the same total, else the
 * latest. An NC only takes a factura whose open amount still has room for
 * its whole total, so a guess never over-credits a factura (as the sales
 * import's matchOriginByTotal); an ND adds debt, so any factura takes it.
 * Room = the factura's own open figure, the one
 * guard_purchase_invoice_open_after_edit checks.
 */
export function pickOriginByTotal(
  candidates: readonly OriginCandidate[],
  note: { kind: "nc" | "nd"; fecha: string; imp_total: number },
): string | null {
  const fits = candidates
    .filter((c) => c.fecha <= note.fecha)
    .filter(
      (c) =>
        note.kind === "nd" || cents(c.open_amount) >= cents(note.imp_total),
    )
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const exact = fits.find((c) => cents(c.imp_total) === cents(note.imp_total));
  return (exact ?? fits[0])?.id ?? null;
}
