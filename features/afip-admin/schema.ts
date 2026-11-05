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

export type PosChannel = {
  id: string;
  name: string;
  is_fiscal: boolean;
  is_active: boolean;
};

/** A POS synced with AFIP goes only to a fiscal channel
 *  (guard_sales_point_channel); a local one (never synced, e.g. 9001) numbers
 *  internal documents, so it goes to an internal channel. The current channel
 *  stays listed even when inactive or of the other kind, so the select can
 *  show it. */
export function posChannelOptions(
  point: { channel_id: string | null; last_synced_at: string | null },
  channels: readonly PosChannel[],
): PosChannel[] {
  const synced = point.last_synced_at !== null;
  return channels.filter(
    (c) => c.id === point.channel_id || (c.is_active && c.is_fiscal === synced),
  );
}

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
