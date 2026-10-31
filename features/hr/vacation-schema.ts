import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

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
