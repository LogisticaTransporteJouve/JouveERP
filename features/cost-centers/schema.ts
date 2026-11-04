import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export type CostCenter = Database["public"]["Tables"]["cost_centers"]["Row"];

const codeRe = /^[A-Z0-9_-]+$/;

export const CostCenterCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(codeRe, "Solo MAYÚSCULAS, números, _ y -."),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional().nullable(),
  is_active: z.boolean().default(true),
  /** The truck whose costs this center carries (margen por camión). */
  vehicle_id: z.string().uuid().nullable().optional(),
});

export const CostCenterUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  is_active: z.boolean().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
});

export const CostCenterDeleteSchema = z.object({ id: z.string().uuid() });

/** A truck a cost center can be linked to. */
export type CostCenterVehicle = {
  id: string;
  patente: string;
  alias: string | null;
  is_active: boolean;
};

/** What a cost picker offers: postable expense accounts and active centers. */
export type CostTagOption = { id: string; code: string; name: string };
export type CostTagOptions = {
  expenseAccounts: CostTagOption[];
  costCenters: CostTagOption[];
  /** Only to name a saved value; never offered for a new selection. */
  inactiveCostCenters: CostTagOption[];
};

// ─── Recategorizing an expense ───────────────────────────────────────────────

/** Where a cost lives: a manual expense or a purchase (the journal's
 *  source_table of each). */
export const EXPENSE_SOURCES = ["transactions", "purchase_invoices"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

/** The permission that edits each source, the same its own form checks. */
export const EXPENSE_SOURCE_WRITE: Record<
  ExpenseSource,
  "transactions:write" | "purchase_invoices:write"
> = {
  transactions: "transactions:write",
  purchase_invoices: "purchase_invoices:write",
};

/** The permission that reads each source. */
export const EXPENSE_SOURCE_READ: Record<
  ExpenseSource,
  "transactions:read" | "purchase_invoices:read"
> = {
  transactions: "transactions:read",
  purchase_invoices: "purchase_invoices:read",
};

/**
 * A new expense account and/or cost center for an expense. A key left out
 * keeps its value; null is the default account (gastos / compras) or no
 * cost center.
 */
export const RecategorizeExpenseSchema = z
  .object({
    source: z.enum(EXPENSE_SOURCES),
    id: z.string().uuid(),
    expense_account_id: z.string().uuid().nullable().optional(),
    cost_center_id: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d) => d.expense_account_id !== undefined || d.cost_center_id !== undefined,
    {
      message: "Indicá la cuenta de gasto o el centro de costo.",
      path: ["expense_account_id"],
    },
  );
export type RecategorizeExpenseInput = z.infer<
  typeof RecategorizeExpenseSchema
>;

export const ExpenseRefSchema = z.object({
  source: z.enum(EXPENSE_SOURCES),
  id: z.string().uuid(),
});

/** An expense as recategorizing shows it: what it is and its current tags. */
export type ExpenseCostTags = {
  source: ExpenseSource;
  id: string;
  /** "12/10/2026 · Combustible YPF · $ 120.000,00". */
  label: string;
  expense_account_id: string | null;
  cost_center_id: string | null;
  /** Why it cannot be recategorized here, or null. */
  blocked: string | null;
};
