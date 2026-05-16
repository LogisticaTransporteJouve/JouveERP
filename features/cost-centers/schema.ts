import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const COST_CENTERS_PATH = "/accounting/cost-centers";

export type CostCenter = Database["public"]["Tables"]["cost_centers"]["Row"];

const codeRe = /^[A-Z0-9_-]+$/;

export const CostCenterCreateSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(codeRe, "Solo MAYÚSCULAS, números, _ y -."),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const CostCenterUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const CostCenterDeleteSchema = z.object({ id: z.string().uuid() });
