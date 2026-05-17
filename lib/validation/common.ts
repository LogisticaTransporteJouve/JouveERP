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
