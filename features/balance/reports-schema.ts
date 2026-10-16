import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { PeriodSchema, UuidSchema } from "@/lib/validation/common";

type Fn = Database["public"]["Functions"];

// Inputs of the journal aggregate reads (accrual periods YYYY-MM). The
// `.describe()` texts double as the assistant's tool parameter docs.

export const AccountTypeTotalsInputSchema = z
  .object({
    periodEnd: PeriodSchema.describe("Período de corte, YYYY-MM."),
    periodStart: PeriodSchema.nullish().describe(
      "Período desde, YYYY-MM. Sin él, acumula desde el inicio (balance).",
    ),
    costCenterId: UuidSchema.nullish().describe(
      "UUID de un centro de costo (opcional).",
    ),
  })
  .refine(
    (v) => !v.periodStart || v.periodStart <= v.periodEnd,
    "El período desde es posterior al de corte.",
  );

export const PeriodRangeReportInputSchema = z
  .object({
    periodStart: PeriodSchema.describe("Período desde, YYYY-MM."),
    periodEnd: PeriodSchema.describe("Período hasta, YYYY-MM (inclusive)."),
  })
  .refine(
    (v) => v.periodStart <= v.periodEnd,
    "El período desde es posterior al período hasta.",
  );

export type AccountTypeTotalsRow =
  Fn["ai_account_type_totals"]["Returns"][number];
export type CostCenterBreakdownRow =
  Fn["ai_cost_center_breakdown"]["Returns"][number];
export type ExpenseByCategoryRow =
  Fn["ai_expense_by_category"]["Returns"][number];
