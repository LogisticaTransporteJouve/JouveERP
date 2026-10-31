// Reusable schemas for validating server action inputs at the boundary.
// Centralizes the common building blocks (UUID, period YYYY-MM, ISO date,
// capped notes) to avoid repeating inline regexes in every action.

import { z } from "zod";

import { FISCAL_FILTERS } from "@/lib/scope";

/** Standard UUID v4 (what gen_random_uuid returns in Postgres). */
export const UuidSchema = z.string().uuid("ID inválido.");

/** "YYYY-MM" (accounting period). Month 01-12. */
export const PeriodSchema = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "Período inválido (YYYY-MM).");

/** "YYYY-MM-DD" (plain calendar date, no TZ). */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

/** Nullable free-text notes; defensive cap + trim. */
export const NotesSchema = z
  .string()
  .trim()
  .max(2000, "Máx 2000 caracteres.")
  .nullable()
  .optional();

/** The scope a read takes, the same three values as the header selector.
 *  Absent = "all". The text doubles as the assistant's tool parameter doc. */
export const ScopeInputSchema = z
  .enum(FISCAL_FILTERS)
  .nullish()
  .describe(
    "Scope: 'fiscal' (fiscal channels only: billing, VAT, anything tax), " +
      "'internal' (internal channels only) or 'all' (every channel, default).",
  );

/** Non-negative amount (opening balances, totals). */
export const NonNegativeAmountSchema = z
  .number()
  .finite()
  .min(0, "El monto no puede ser negativo.");

export const USD_RATE_REQUIRED_MESSAGE =
  "Cargá la cotización del dólar (tiene que ser mayor a 1).";

/** ARS per 1 USD of a receipt or payment order: > 1, at most the 4 decimals
 *  of `numeric(10,4)`. Absent or null on peso documents. */
export const UsdRateSchema = z
  .number()
  .finite(USD_RATE_REQUIRED_MESSAGE)
  .gt(1, USD_RATE_REQUIRED_MESSAGE)
  .lt(1_000_000, "Cotización inválida.")
  .nullable()
  .optional();

/** A USD document carries its rate (the DB trigger has the last word). */
export function usdRateIssue(
  currency: string,
  cotizacion: number | null | undefined,
): string | null {
  return currency === "USD" && cotizacion == null
    ? USD_RATE_REQUIRED_MESSAGE
    : null;
}

/**
 * Zod preprocess for amounts in es-AR format ("1.234,56" → 1234.56) that
 * also accepts a direct `number`. Empty/whitespace string → `undefined` (which
 * fails on `.number()`). Consolidates 4 verbatim copies that lived in the
 * receipts/checks/transactions/payment-orders schemas. */
export const moneyAmountPreprocess = (value: unknown) => {
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\./g, "").replace(",", ".");
    if (cleaned.length === 0) return undefined;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};

/** Variant of moneyAmountPreprocess for the opening balance of accounts:
 *  empty string → 0 (empty means "no initial balance", not "invalid"). */
export const openingBalancePreprocess = (value: unknown) => {
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\./g, "").replace(",", ".");
    if (cleaned.length === 0) return 0;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};

/** Variant that pre-strips non-numeric characters (keeps `0-9 , . -`).
 *  More defensive for typed inputs where the user may paste "$ 1.234,56"
 *  or "ARS 1.234,56". Used by the purchase-invoices and issued-checks schemas. */
export const moneyAmountWithStripPreprocess = (value: unknown) => {
  if (typeof value === "string") {
    const cleaned = value
      .replace(/[^0-9.,-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    if (cleaned.length === 0) return undefined;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};
