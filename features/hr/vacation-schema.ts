import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

// ─── Leaves ──────────────────────────────────────────────────────────────────

export const LEAVE_KINDS = [
  "vacaciones",
  "enfermedad",
  "franco",
  "maternidad",
  "paternidad",
  "otro",
] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const LEAVE_KIND_LABEL: Record<LeaveKind, string> = {
  vacaciones: "Vacaciones",
  enfermedad: "Enfermedad",
  franco: "Franco",
  maternidad: "Maternidad",
  paternidad: "Paternidad",
  otro: "Otro",
};

export function isLeaveKind(value: unknown): value is LeaveKind {
  return (
    typeof value === "string" &&
    (LEAVE_KINDS as readonly string[]).includes(value)
  );
}

export const CreateLeaveSchema = z
  .object({
    employee_id: z.string().uuid(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(LEAVE_KINDS),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "La fecha de fin no puede ser anterior al inicio.",
    path: ["end_date"],
  });

export const DeleteLeaveSchema = z.object({ id: z.string().uuid() });

export type CreateLeaveInput = z.infer<typeof CreateLeaveSchema>;

type LeaveRow = Database["public"]["Tables"]["employee_leaves"]["Row"];
export type EmployeeLeave = Omit<LeaveRow, "kind"> & { kind: LeaveKind };

/** Most leaves one range read returns; more sets `partial`. */
export const LEAVES_BY_RANGE_CAP = 500;

/** Leaves that overlap a date range, of every employee or one. The
 *  `.describe()` texts double as the assistant's tool parameter docs. */
export const LeavesByRangeInputSchema = z
  .object({
    from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
    to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
    employeeId: UuidSchema.nullish().describe(
      "employee_id (de searchEmployees) para ver uno solo; vacío = todos.",
    ),
    kind: z
      .enum(LEAVE_KINDS)
      .nullish()
      .describe("Solo un tipo de licencia (ej. vacaciones); vacío = todos."),
  })
  .refine((v) => v.from <= v.to, {
    message: "La fecha desde es posterior a la fecha hasta.",
    path: ["to"],
  });

export const HolidayRangeSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
});

/** One leave of a range read, with the days that fall inside the range. */
export type LeaveInRange = {
  id: string;
  employee_id: string;
  employee: string;
  kind: LeaveKind;
  kind_label: string;
  start_date: string;
  end_date: string;
  /** Calendar days of the whole leave (end − start + 1). */
  days: number;
  /** Calendar days of the leave inside [from, to]. */
  days_in_range: number;
};

export type LeavesByRange = {
  rows: LeaveInRange[];
  /** More leaves overlap the range than the cap returned. */
  partial: boolean;
};

// ─── Vacation balances ───────────────────────────────────────────────────────

export const VACATION_BALANCE_STATUSES = [
  "active",
  "expired",
  "extended",
] as const;
export type VacationBalanceStatus = (typeof VACATION_BALANCE_STATUSES)[number];

export const VACATION_BALANCE_STATUS_LABEL: Record<
  VacationBalanceStatus,
  string
> = {
  active: "Activo",
  expired: "Expirado",
  extended: "Extendido",
};

export function isVacationBalanceStatus(
  value: unknown,
): value is VacationBalanceStatus {
  return (
    typeof value === "string" &&
    (VACATION_BALANCE_STATUSES as readonly string[]).includes(value)
  );
}

export type VacationBalance = {
  id: string;
  employee_id: string;
  period_year: number;
  entitled_days: number;
  bonus_days: number;
  carryover_days: number;
  used_days: number;
  remaining_days: number;
  granted_at: string;
  expires_at: string;
  status: VacationBalanceStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Opening balance (days loaded by hand) ──────────────────────────────────

const vacationDays = z.coerce
  .number()
  .int("Tiene que ser un número entero de días.")
  .min(0, "No puede ser negativo.")
  .max(365, "Demasiados días.");

/** The two numbers HR loads per employee: the current period's days and the
 *  days still pending from earlier years, as one figure. */
export const SetVacationOpeningSchema = z.object({
  employee_id: z.string().uuid(),
  current_days: vacationDays,
  previous_days: vacationDays,
});

export type SetVacationOpeningInput = z.infer<typeof SetVacationOpeningSchema>;

/** One row of Personal → Vacaciones. */
export type VacationOverviewRow = {
  employee_id: string;
  legal_name: string;
  hire_date: string;
  period_year: number;
  /** Days of the current period (entitled + extra), null when not granted. */
  current_days: number | null;
  /** Automatic carryover into the current period. */
  carryover_days: number;
  /** Still pending from earlier periods kept open (extended or active). */
  previous_days: number;
  /** Days taken in the current period. */
  used_days: number;
  /** Available now: current period plus earlier pending days. */
  remaining_days: number;
  expires_at: string | null;
};
