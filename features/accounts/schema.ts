import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

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

export const ACCOUNTS_PATH = "/accounts";

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const openingBalance = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const cleaned = value.trim().replace(/\./g, "").replace(",", ".");
      if (cleaned.length === 0) return 0;
      const parsed = Number.parseFloat(cleaned);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  },
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

export type AccountCreateInput = z.infer<typeof AccountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof AccountUpdateSchema>;
export type AccountToggleActiveInput = z.infer<typeof AccountToggleActiveSchema>;

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
