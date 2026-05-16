import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const INFLATION_PATH = "/accounting/inflation";

export type InflationAdjustment =
  Database["public"]["Tables"]["inflation_adjustments"]["Row"];

export const InflationAdjustmentCreateSchema = z.object({
  period: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "Formato YYYY-MM."),
  coefficient: z
    .number({ message: "Coeficiente requerido." })
    .positive("Debe ser mayor a cero.")
    .max(999.999999, "Demasiado alto."),
  index_source: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const InflationAdjustmentDeleteSchema = z.object({
  id: z.string().uuid(),
});
