import { z } from "zod";
import { isValidCuit } from "@/lib/validation/cuit";

import type { Database } from "@/lib/db/database.types";

export const ConfigurePosSchema = z.object({
  numero: z.number().int().min(1).max(99999),
  channel_id: z.string().min(1).nullable(),
  nickname: z.string().trim().min(1).max(120).nullable(),
  is_enabled: z.boolean(),
});

export type ConfigurePosInput = z.input<typeof ConfigurePosSchema>;

export type AfipLastNumberRow =
  Database["public"]["Functions"]["ai_afip_last_numbers"]["Returns"][number];

// ---------------------------------------------------------------------------
// ARCA web account (Mis Comprobantes robot)
// ---------------------------------------------------------------------------

export const ArcaWebCredentialsSchema = z.object({
  cuit: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine(isValidCuit, "CUIT inválido."),
  /** Empty keeps the stored clave. */
  password: z
    .string()
    .max(200, "La clave es demasiado larga.")
    .optional()
    .transform((v) => (v ? v : null)),
});
export type ArcaWebCredentialsInput = z.input<typeof ArcaWebCredentialsSchema>;
