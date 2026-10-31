import { z } from "zod";
import { moneyAmountPreprocess } from "@/lib/validation/common";

import type { Database } from "@/lib/db/database.types";

export const CHECK_KINDS = ["fisico", "echeq"] as const;
export type ChequeKind = (typeof CHECK_KINDS)[number];

export const CHECK_KIND_LABEL: Record<ChequeKind, string> = {
  fisico: "Físico",
  echeq: "e-cheq",
};

export const CHECK_STATUSES = [
  "en_cartera",
  "depositado",
  "acreditado",
  "endosado",
  "rechazado",
] as const;
export type ChequeStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_STATUS_LABEL: Record<ChequeStatus, string> = {
  en_cartera: "En cartera",
  depositado: "Depositado",
  acreditado: "Acreditado",
  endosado: "Endosado",
  rechazado: "Rechazado",
};

export const CHEQUE_CURRENCIES = ["ARS", "USD"] as const;
export type ChequeCurrency = (typeof CHEQUE_CURRENCIES)[number];

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v.length === 0 ? null : v))
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

// CUIT may come with hyphens; we normalize it to 11 digits. It's optional
// for drawer / endorsed_to because sometimes the client only gives us the
// name (e.g. a check a third party handed them).
const optionalCuit = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9]/g, ""))
  .refine((value) => value.length === 0 || /^[0-9]{11}$/.test(value), {
    message: "CUIT debe tener 11 dígitos.",
  })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

export const ChequeCreateSchema = z.object({
  kind: z.enum(CHECK_KINDS),
  check_number: z.string().trim().min(1, "Número requerido.").max(60),
  bank_name: z.string().trim().min(1, "Banco requerido.").max(120),
  drawer_name: z.string().trim().min(1, "Firmante requerido.").max(120),
  drawer_cuit: optionalCuit,
  issue_date: isoDate,
  due_date: isoDate,
  amount: moneyAmount,
  currency: z.enum(CHEQUE_CURRENCIES),
  cartera_account_id: z.string().uuid("Cuenta de cartera requerida."),
  source_kind: z.enum(["receipt", "manual"]).default("manual"),
  source_receipt_id: z.string().uuid().nullable().optional(),
  source_payment_line_id: z.string().uuid().nullable().optional(),
  source_client_id: z.string().uuid().nullable().optional(),
  notes: trimmedNullable,
});

// The manual form always picks a channel; checks created from a document
// extraction may still arrive without one and get it on deposit or endorsement.
export const ManualChequeCreateSchema = ChequeCreateSchema.extend({
  channel_id: z.string().min(1, "Canal requerido."),
});

export const DepositChequeSchema = z.object({
  check_id: z.string().uuid(),
  account_id: z.string().uuid("Cuenta destino requerida."),
  channel_id: z.string().min(1, "Canal requerido."),
  event_date: isoDate,
  description: trimmedNullable,
});

export const CreditChequeSchema = z.object({
  check_id: z.string().uuid(),
  event_date: isoDate,
  notes: trimmedNullable,
});

export const RejectChequeSchema = z.object({
  check_id: z.string().uuid(),
  account_id: z.string().uuid("Cuenta bancaria requerida."),
  channel_id: z.string().min(1, "Canal requerido."),
  event_date: isoDate,
  notes: trimmedNullable,
});

export type ChequeCreateInput = z.infer<typeof ChequeCreateSchema>;
export type ManualChequeCreateInput = z.infer<typeof ManualChequeCreateSchema>;
export type DepositChequeInput = z.infer<typeof DepositChequeSchema>;
export type CreditChequeInput = z.infer<typeof CreditChequeSchema>;
export type RejectChequeInput = z.infer<typeof RejectChequeSchema>;

export function isChequeKind(value: unknown): value is ChequeKind {
  return (
    typeof value === "string" &&
    (CHECK_KINDS as readonly string[]).includes(value)
  );
}

export function isChequeStatus(value: unknown): value is ChequeStatus {
  return (
    typeof value === "string" &&
    (CHECK_STATUSES as readonly string[]).includes(value)
  );
}

export function isChequeCurrency(value: unknown): value is ChequeCurrency {
  return (
    typeof value === "string" &&
    (CHEQUE_CURRENCIES as readonly string[]).includes(value)
  );
}

type CheckRow = Database["public"]["Tables"]["checks"]["Row"];
export type Cheque = Omit<CheckRow, "kind" | "status" | "currency"> & {
  kind: ChequeKind;
  status: ChequeStatus;
  currency: ChequeCurrency;
};

export type CheckMovement =
  Database["public"]["Tables"]["check_movements"]["Row"];
