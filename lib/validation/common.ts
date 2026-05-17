// Schemas reutilizables para validar inputs de server actions en boundary.
// Centraliza los building blocks comunes (UUID, period YYYY-MM, ISO date,
// notes con cap) para no repetir regex inline en cada action.

import { z } from "zod";

/** UUID v4 estándar (lo que devuelve gen_random_uuid en Postgres). */
export const UuidSchema = z.string().uuid("ID inválido.");

/** "YYYY-MM" (período contable). Mes 01-12. */
export const PeriodSchema = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "Período inválido (YYYY-MM).");

/** "YYYY-MM-DD" (fecha calendario simple, sin TZ). */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

/** Notes/texto libre nullable; cap defensivo + trim. */
export const NotesSchema = z
  .string()
  .trim()
  .max(2000, "Máx 2000 caracteres.")
  .nullable()
  .optional();

/** Monto no-negativo (saldos de apertura, totales). */
export const NonNegativeAmountSchema = z
  .number()
  .finite()
  .min(0, "El monto no puede ser negativo.");

/**
 * Preprocess zod para montos en formato es-AR ("1.234,56" → 1234.56) que
 * además acepta `number` directo. Empty/whitespace string → `undefined` (lo
 * que falla con `.number()`). Consolida 4 copias verbatim que vivían en
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

/** Variante de moneyAmountPreprocess para el saldo de apertura de cuentas:
 *  empty string → 0 (vacío significa "sin saldo inicial", no "inválido"). */
export const openingBalancePreprocess = (value: unknown) => {
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\./g, "").replace(",", ".");
    if (cleaned.length === 0) return 0;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};

/** Variante con pre-strip de caracteres no-numéricos (mantiene `0-9 , . -`).
 *  Más defensivo para inputs typed donde el user puede pegar "$ 1.234,56"
 *  o "ARS 1.234,56". Usado por purchase-invoices y issued-checks schemas. */
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
