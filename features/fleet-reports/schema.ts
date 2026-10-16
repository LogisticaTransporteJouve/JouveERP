import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { IsoDateSchema } from "@/lib/validation/common";

// Input of the fleet margin read. The `.describe()` texts double as the
// assistant's tool parameter docs.

export const FLEET_MARGIN_GROUPS = [
  "trip",
  "driver",
  "vehicle",
  "client",
] as const;

export const FleetMarginInputSchema = z
  .object({
    from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
    to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
    groupBy: z
      .enum(FLEET_MARGIN_GROUPS)
      .nullish()
      .describe("Agrupar por viaje, chofer, vehículo (default) o cliente."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .nullish()
      .describe("Máximo de filas (default 50); los totales cubren todo."),
  })
  .refine(
    (v) => v.from <= v.to,
    "La fecha desde es posterior a la fecha hasta.",
  );

export type FleetMarginRow =
  Database["public"]["Functions"]["ai_fleet_margin"]["Returns"][number];
