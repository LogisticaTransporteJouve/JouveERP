import { z } from "zod";

import type { Permission } from "@/lib/auth/permissions";

// Importador (roadmap 5.1 + 5.2): a spreadsheet read into one kind of record.
// Master data (clients, suppliers, employees, vehicles) lands in its own
// table; historic payroll and trips land in tables of their own that nothing
// else reads (supabase/migrations/20261103110000_import_runs.sql).

export const IMPORT_KINDS = [
  "clients",
  "suppliers",
  "employees",
  "vehicles",
  "historic_payroll",
  "historic_trips",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  clients: "Clientes",
  suppliers: "Proveedores",
  employees: "Empleados",
  vehicles: "Vehículos",
  historic_payroll: "Sueldos históricos",
  historic_trips: "Viajes históricos",
};

/** What the run creates, beside imports:write: the module's own write. */
export const IMPORT_KIND_PERMISSION: Record<ImportKind, Permission> = {
  clients: "clients:write",
  suppliers: "suppliers:write",
  employees: "hr:write",
  vehicles: "vehicles:write",
  historic_payroll: "hr:write",
  historic_trips: "trips:write",
};

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
