import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

/** Mirrors check_sales.status. */
export const CHECK_SALE_STATUSES = ["active", "cancelled"] as const;
export type CheckSaleStatus = (typeof CHECK_SALE_STATUSES)[number];

export function isCheckSaleStatus(v: unknown): v is CheckSaleStatus {
  return (
    typeof v === "string" &&
    (CHECK_SALE_STATUSES as readonly string[]).includes(v)
  );
}

export type CheckSaleCurrency = "ARS" | "USD";

export function isCheckSaleCurrency(v: unknown): v is CheckSaleCurrency {
  return v === "ARS" || v === "USD";
}

export interface CheckSale {
  id: string;
  sale_date: string;
  buyer_name: string;
  account_name: string;
  currency: CheckSaleCurrency;
  gross_amount: number;
  interest_amount: number;
  commission_amount: number;
  net_amount: number;
  status: CheckSaleStatus;
  cancel_reason: string | null;
  checks: number;
}

export interface CheckSaleDebt {
  id: string;
  check_id: string;
  check_number: string;
  bank_name: string;
  buyer_name: string;
  amount: number;
  currency: CheckSaleCurrency;
  rejected_on: string;
  paid_at: string | null;
}

/** Sold checks not due yet (endoso con recurso: the company answers for
 *  them until they are paid) and debts to buyers, per currency. */
export interface SoldChecksExposure {
  contingent: { currency: CheckSaleCurrency; amount: number; checks: number }[];
  debts: { currency: CheckSaleCurrency; amount: number; count: number }[];
}

/** Totals per currency, in first-seen order. */
export function sumByCurrency<T>(
  rows: readonly T[],
  currency: (row: T) => CheckSaleCurrency,
  amount: (row: T) => number,
): { currency: CheckSaleCurrency; amount: number; count: number }[] {
  const map = new Map<CheckSaleCurrency, { amount: number; count: number }>();
  for (const row of rows) {
    const c = currency(row);
    const acc = map.get(c) ?? { amount: 0, count: 0 };
    acc.amount = Math.round((acc.amount + amount(row)) * 100) / 100;
    acc.count += 1;
    map.set(c, acc);
  }
  return [...map.entries()].map(([c, v]) => ({ currency: c, ...v }));
}

export const CancelCheckSaleSchema = z.object({
  sale_id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Contá por qué se anula la venta.")
    .max(500, "Máximo 500 caracteres."),
});
export type CancelCheckSaleInput = z.input<typeof CancelCheckSaleSchema>;

export const RejectSoldCheckAsDebtSchema = z.object({
  check_id: z.string().uuid(),
  event_date: IsoDateSchema,
  notes: z.string().trim().max(1000).optional(),
});
export type RejectSoldCheckAsDebtInput = z.input<
  typeof RejectSoldCheckAsDebtSchema
>;

export const PayCheckSaleDebtSchema = z.object({
  debt_id: z.string().uuid(),
  account_id: z.string().uuid("Elegí la cuenta."),
  payment_date: IsoDateSchema,
});
export type PayCheckSaleDebtInput = z.input<typeof PayCheckSaleDebtSchema>;
