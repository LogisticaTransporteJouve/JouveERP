import { z } from "zod";

import type { Permission } from "@/lib/auth/permissions";

import { CHECK_CASH_PERMISSIONS } from "@/features/checks/lib/check-cash";

// Importador (roadmap 5.1 to 5.4): a spreadsheet read into one kind of
// record. Master data (clients, suppliers, employees, vehicles) lands in its
// own table; historic payroll and trips land in tables of their own that
// nothing else reads (supabase/migrations/20261103110000_import_runs.sql).
// The go-live items (tariffs, loans, cartera checks, client opening balances)
// and bank statements land where the app's own forms put them
// (supabase/migrations/20261103140100_import_opening_items.sql).

export const IMPORT_KINDS = [
  "clients",
  "suppliers",
  "employees",
  "vehicles",
  "historic_payroll",
  "historic_trips",
  "client_tariffs",
  "loans",
  "checks",
  "opening_balances",
  "bank_statement",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  clients: "Clientes",
  suppliers: "Proveedores",
  employees: "Empleados",
  vehicles: "Vehículos",
  historic_payroll: "Sueldos históricos",
  historic_trips: "Viajes históricos",
  client_tariffs: "Tarifas por cliente",
  loans: "Préstamos al arranque",
  checks: "Cheques en cartera al arranque",
  opening_balances: "Saldos iniciales de clientes",
  bank_statement: "Extracto bancario",
};

/** What the run creates, beside imports:write: the module's own write
 *  (gate with `userCanAll`). Checks also book their cartera inflow, and the
 *  undo deletes it, so they need transactions:write as «Nuevo cheque» does. */
export const IMPORT_KIND_PERMISSION: Record<
  ImportKind,
  Permission | readonly Permission[]
> = {
  clients: "clients:write",
  suppliers: "suppliers:write",
  employees: "hr:write",
  vehicles: "vehicles:write",
  historic_payroll: "hr:write",
  historic_trips: "trips:write",
  client_tariffs: "storage_billing:issue",
  loans: "accounting:write",
  checks: CHECK_CASH_PERMISSIONS,
  opening_balances: "opening_balances:write",
  bank_statement: "transactions:write",
};

/** The kinds whose rows go to one treasury account the user picks: the
 *  cartera of the checks, the account of the statement. */
const ACCOUNT_KINDS: readonly ImportKind[] = ["checks", "bank_statement"];

/** The kinds whose rows take one channel the user picks. */
const CHANNEL_KINDS: readonly ImportKind[] = ["loans", "checks"];

export function kindNeedsAccount(kind: ImportKind): boolean {
  return ACCOUNT_KINDS.includes(kind);
}

export function kindNeedsChannel(kind: ImportKind): boolean {
  return CHANNEL_KINDS.includes(kind);
}

/** Money items with one row per key: a key repeated in the file is an error
 *  in both rows (skipping one would drop an amount silently). */
const STRICT_KEY_KINDS: readonly ImportKind[] = [
  "client_tariffs",
  "loans",
  "checks",
  "opening_balances",
];

export function kindHasStrictKeys(kind: ImportKind): boolean {
  return STRICT_KEY_KINDS.includes(kind);
}

/** Reading a kind's historic rows needs its module's read as well. */
export const HISTORIC_READ_PERMISSION = {
  historic_payroll: "hr:read",
  historic_trips: "trips:read",
} as const satisfies Partial<Record<ImportKind, Permission>>;

export function isImportKind(value: unknown): value is ImportKind {
  return (
    typeof value === "string" &&
    (IMPORT_KINDS as readonly string[]).includes(value)
  );
}

export const IMPORT_RUN_STATUSES = ["committed", "undone"] as const;
export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export function isImportRunStatus(value: unknown): value is ImportRunStatus {
  return (
    typeof value === "string" &&
    (IMPORT_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/** Field → column index, as the user left it in the dialog. */
export const ImportMappingSchema = z.record(
  z.string().max(40),
  z.number().int().min(0).max(199),
);

export const ImportRequestSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  mapping: ImportMappingSchema.nullable(),
  /** The cartera (checks) or the statement's account (bank_statement). */
  account_id: z.string().uuid().nullable().default(null),
  /** The channel of loans and checks. */
  channel_id: z.string().min(1).max(60).nullable().default(null),
});
export type ImportRequestInput = z.infer<typeof ImportRequestSchema>;

export const UndoImportRunSchema = z.object({ id: z.string().uuid() });

export const HistoricPayrollListSchema = z.object({
  year: z.number().int().min(1990).max(2100),
});

export const HistoricTripsListSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido."),
});

// ─── Rows the RPC receives ───────────────────────────────────────────────────

export const HISTORIC_PAYROLL_KINDS = ["monthly", "sac"] as const;
export type HistoricPayrollKind = (typeof HISTORIC_PAYROLL_KINDS)[number];

export const HISTORIC_PAYROLL_KIND_LABELS: Record<HistoricPayrollKind, string> =
  {
    monthly: "Mensual",
    sac: "Aguinaldo",
  };

const money = z.number().min(0, "No puede ser negativo.").max(999_999_999_999);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

/** One historic payroll row: an employee's net (and paid) of a month. */
export const HistoricPayrollRowSchema = z
  .object({
    employee_id: z.string().uuid(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Período inválido."),
    kind: z.enum(HISTORIC_PAYROLL_KINDS),
    net_amount: money,
    paid_amount: money.nullable(),
    paid_on: isoDate.nullable(),
    notes: optionalText(500),
  })
  .refine((r) => r.kind !== "sac" || /-(06|12)$/.test(r.period), {
    message: "El aguinaldo es de junio o diciembre.",
    path: ["kind"],
  });
export type HistoricPayrollRow = z.infer<typeof HistoricPayrollRowSchema>;

/** One historic trip; a vehicle, driver or client not found keeps its text. */
export const HistoricTripRowSchema = z.object({
  trip_date: isoDate,
  vehicle_id: z.string().uuid().nullable(),
  vehicle_label: optionalText(120),
  driver_id: z.string().uuid().nullable(),
  driver_label: optionalText(120),
  client_id: z.string().uuid().nullable(),
  client_label: optionalText(120),
  origin: optionalText(200),
  destination: optionalText(200),
  km: z
    .number()
    .min(0, "Los km no pueden ser negativos.")
    .max(999_999_999)
    .nullable(),
  freight_amount: money.nullable(),
  notes: optionalText(500),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type HistoricTripRow = z.infer<typeof HistoricTripRowSchema>;

const currency = z.enum(["ARS", "USD"]);
const positiveMoney = z
  .number()
  .gt(0, "Tiene que ser mayor a cero.")
  .max(999_999_999_999);
const signedMoney = z.number().min(-999_999_999_999).max(999_999_999_999);

/** One loan installment of the pending schedule. */
export const LoanImportInstallmentSchema = z.object({
  number: z.number().int().min(1).max(600),
  due_date: isoDate,
  amount: money,
});

/** A loan at go-live: the capital still owed and its pending schedule. */
export const LoanImportRowSchema = z
  .object({
    kind: z.enum(["prestamo", "leasing"]),
    description: z.string().trim().min(1).max(200),
    lender: optionalText(200),
    principal: positiveMoney,
    currency,
    channel_id: z.string().min(1),
    installments_count: z.number().int().min(1).max(600),
    first_due_date: isoDate,
    notes: optionalText(2000),
    installments: z.array(LoanImportInstallmentSchema).min(1).max(600),
  })
  .refine((r) => r.installments.length === r.installments_count, {
    message: "El cronograma no coincide con la cantidad de cuotas.",
    path: ["installments"],
  });
export type LoanImportRow = z.infer<typeof LoanImportRowSchema>;

/** What a client owes at go-live (client_opening_balances, in pesos). */
export const OpeningBalanceImportRowSchema = z.object({
  client_id: z.string().uuid(),
  opening_date: isoDate,
  target_balance: money,
  notes: optionalText(500),
});
export type OpeningBalanceImportRow = z.infer<
  typeof OpeningBalanceImportRowSchema
>;

/** One bank statement line: + credit, - debit. */
export const BankStatementImportRowSchema = z.object({
  account_id: z.string().uuid(),
  line_date: isoDate,
  description: z.string().trim().min(1).max(500),
  amount: signedMoney.refine((v) => v !== 0, "La línea no tiene importe."),
  balance: signedMoney.nullable(),
  reference: optionalText(120),
  /** The bank's code for the movement (Macro: "Código Causal"). */
  bank_code: optionalText(20),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type BankStatementImportRow = z.infer<
  typeof BankStatementImportRowSchema
>;
