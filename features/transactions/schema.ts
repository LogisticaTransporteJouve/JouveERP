import { z } from "zod";
import { moneyAmountPreprocess } from "@/lib/validation/common";

import type { Database } from "@/lib/db/database.types";

export const TRANSACTION_KINDS = [
  "income",
  "expense",
  "transfer_in",
  "transfer_out",
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_KIND_LABEL: Record<TransactionKind, string> = {
  income: "Ingreso",
  expense: "Egreso",
  transfer_in: "Transferencia (entra)",
  transfer_out: "Transferencia (sale)",
};

export const TRANSACTION_CURRENCIES = ["ARS", "USD"] as const;
export type TransactionCurrency = (typeof TRANSACTION_CURRENCIES)[number];

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const moneyAmount = z.preprocess(
  moneyAmountPreprocess,
  z
    .number()
    .finite("Importe inválido.")
    .gt(0, "El importe debe ser mayor a cero.")
    .max(1_000_000_000_000),
);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

const accrualMonth = isoDate.refine(
  (value) => value.endsWith("-01"),
  "El mes devengado debe ser el día 1 (YYYY-MM-01).",
);

/** Expense account (a postable leaf of the chart) or cost center; "" = none. */
const optionalCostTagId = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const EXPENSE_ACCOUNT_ONLY_ON_EXPENSE =
  "La cuenta de gasto es solo para egresos.";

// ---------------------------------------------------------------------------
// Single-row create (income | expense)
// ---------------------------------------------------------------------------

export const TransactionCreateSchema = z
  .object({
    account_id: z.string().uuid("Cuenta requerida."),
    channel_id: z.string().min(1, "Canal requerido."),
    kind: z.enum(["income", "expense"]),
    amount: moneyAmount,
    currency: z.enum(TRANSACTION_CURRENCIES),
    transaction_date: isoDate,
    accrual_month: accrualMonth,
    description: trimmedNullable,
    invoice_id: z.string().uuid().nullable().optional(),
    counterparty_client_id: z.string().uuid().nullable().optional(),
    /** Manual expense only: the account the entry debits instead of gastos. */
    expense_account_id: optionalCostTagId,
    cost_center_id: optionalCostTagId,
  })
  .refine((d) => d.kind === "expense" || !d.expense_account_id, {
    message: EXPENSE_ACCOUNT_ONLY_ON_EXPENSE,
    path: ["expense_account_id"],
  });

export type TransactionCreateInput = z.infer<typeof TransactionCreateSchema>;

// ---------------------------------------------------------------------------
// Transfer create (paired rows)
// ---------------------------------------------------------------------------

export const TransferCreateSchema = z
  .object({
    account_from_id: z.string().uuid("Cuenta origen requerida."),
    account_to_id: z.string().uuid("Cuenta destino requerida."),
    channel_id: z.string().min(1, "Canal requerido."),
    amount: moneyAmount,
    currency: z.enum(TRANSACTION_CURRENCIES),
    transaction_date: isoDate,
    accrual_month: accrualMonth,
    description: trimmedNullable,
  })
  .refine((data) => data.account_from_id !== data.account_to_id, {
    message: "La cuenta origen y la destino deben ser distintas.",
    path: ["account_to_id"],
  });

export type TransferCreateInput = z.infer<typeof TransferCreateSchema>;

// ---------------------------------------------------------------------------
// Update (header fields only — account / channel / kind are immutable to
// avoid breaking the transfer-pair invariant; deletion + recreate is the
// supported flow when those need to change)
// ---------------------------------------------------------------------------

export const TransactionUpdateSchema = z.object({
  id: z.string().uuid(),
  amount: moneyAmount,
  transaction_date: isoDate,
  accrual_month: accrualMonth,
  description: trimmedNullable,
  counterparty_client_id: z.string().uuid().nullable().optional(),
  /** Absent leaves the column as is (the database refuses an account on a
   *  movement that is not a manual expense). */
  expense_account_id: optionalCostTagId,
  cost_center_id: optionalCostTagId,
});

export type TransactionUpdateInput = z.infer<typeof TransactionUpdateSchema>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Caja's reconciliation filter: matched with a bank statement line or not. */
export const RECONCILED_FILTERS = ["yes", "no"] as const;
export type ReconciledFilter = (typeof RECONCILED_FILTERS)[number];

export const RECONCILED_FILTER_LABEL: Record<ReconciledFilter, string> = {
  yes: "Conciliados",
  no: "Sin conciliar",
};

export function isReconciledFilter(value: unknown): value is ReconciledFilter {
  return (
    typeof value === "string" &&
    (RECONCILED_FILTERS as readonly string[]).includes(value)
  );
}

export const TransactionFiltersSchema = z.object({
  /** One movement (the journal's link to its origin). */
  id: z.string().uuid().nullable().optional(),
  channel_id: z.string().nullable().optional(),
  /** Scope filter (`isFiscalFor`): null/absent = every channel. */
  is_fiscal: z.boolean().nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  kind: z.enum(TRANSACTION_KINDS).nullable().optional(),
  reconciled: z.enum(RECONCILED_FILTERS).nullable().optional(),
  date_from: isoDate.nullable().optional(),
  date_to: isoDate.nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export type TransactionFilters = z.infer<typeof TransactionFiltersSchema>;

// ---------------------------------------------------------------------------
// Type narrowers
// ---------------------------------------------------------------------------

export function isTransactionKind(value: unknown): value is TransactionKind {
  return (
    typeof value === "string" &&
    (TRANSACTION_KINDS as readonly string[]).includes(value)
  );
}

export function isTransactionCurrency(
  value: unknown,
): value is TransactionCurrency {
  return (
    typeof value === "string" &&
    (TRANSACTION_CURRENCIES as readonly string[]).includes(value)
  );
}

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
export type Transaction = Omit<TransactionRow, "kind" | "currency"> & {
  kind: TransactionKind;
  currency: TransactionCurrency;
};

/**
 * Returns the first day of the given transaction date as ISO `YYYY-MM-01`.
 * Used by the form to default `accrual_month` to the same month as
 * `transaction_date` — most cashflow accruals match the payment month.
 */
export function defaultAccrualMonth(transactionDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(transactionDate);
  if (!m) return transactionDate;
  return `${m[1]}-${m[2]}-01`;
}
