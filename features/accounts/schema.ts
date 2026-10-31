import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { openingBalancePreprocess } from "@/lib/validation/common";

export const ACCOUNT_TYPES = [
  "bank",
  "cash",
  "wallet",
  "investment",
  "checks",
  "echeq",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: "Cuenta bancaria",
  cash: "Efectivo",
  wallet: "Billetera digital",
  investment: "Inversión",
  checks: "Cheques físicos en cartera",
  echeq: "e-cheq en cartera",
};

export function isCheckAccount(type: AccountType | undefined): boolean {
  return type === "checks" || type === "echeq";
}

export const ACCOUNT_CURRENCIES = ["ARS", "USD"] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const openingBalance = z.preprocess(
  openingBalancePreprocess,
  z
    .number()
    .finite("Saldo inicial inválido.")
    .min(-1_000_000_000_000)
    .max(1_000_000_000_000),
);

const baseAccountFields = {
  name: z.string().trim().min(2, "Nombre requerido.").max(120),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(ACCOUNT_CURRENCIES),
  opening_balance: openingBalance,
  notes: trimmedNullable,
};

export const AccountCreateSchema = z.object(baseAccountFields);

export const AccountUpdateSchema = z.object({
  id: z.string().uuid(),
  name: baseAccountFields.name.optional(),
  type: baseAccountFields.type.optional(),
  currency: baseAccountFields.currency.optional(),
  opening_balance: baseAccountFields.opening_balance.optional(),
  notes: baseAccountFields.notes,
});

export const AccountToggleActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

// D4: the adjustment is booked to a channel the user picks; there is no default.
export const AccountOpeningBalanceInputSchema = z.object({
  account_id: z.string().uuid("Cuenta requerida."),
  adjustment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  target_balance: z.number().finite("Saldo inválido."),
  channel_id: z
    .string()
    .trim()
    .min(1, "Elegí un canal para imputar el ajuste."),
  notes: trimmedNullable,
});

export type AccountCreateInput = z.infer<typeof AccountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof AccountUpdateSchema>;
export type AccountToggleActiveInput = z.infer<
  typeof AccountToggleActiveSchema
>;
export type AccountOpeningBalanceInput = z.input<
  typeof AccountOpeningBalanceInputSchema
>;

export function isAccountType(value: unknown): value is AccountType {
  return (
    typeof value === "string" &&
    (ACCOUNT_TYPES as readonly string[]).includes(value)
  );
}

export function isAccountCurrency(value: unknown): value is AccountCurrency {
  return (
    typeof value === "string" &&
    (ACCOUNT_CURRENCIES as readonly string[]).includes(value)
  );
}

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
export type Account = Omit<AccountRow, "type" | "currency"> & {
  type: AccountType;
  currency: AccountCurrency;
};

/** Join row shape for `account ( name, type )` embedded in payment lines. */
export type AccountNameJoin = {
  account: { name: string; type: string } | null;
};

/** Plural variant for list queries that return `accounts ( name )`
 *  as a join embedded in the parent row. */
export type AccountsListNameJoin = {
  accounts: { name: string } | null;
};
