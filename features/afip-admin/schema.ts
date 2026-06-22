import { z } from "zod";

export const ConfigurePosSchema = z.object({
  numero: z.number().int().min(1).max(99999),
  channel_id: z.string().min(1).nullable(),
  nickname: z.string().trim().min(1).max(120).nullable(),
  is_enabled: z.boolean(),
});

export type ConfigurePosInput = z.input<typeof ConfigurePosSchema>;
