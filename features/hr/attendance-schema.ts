import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

// ─── Attendance ──────────────────────────────────────────────────────────────

export const ATTENDANCE_KINDS = [
  "absent_justified",
  "absent_unjustified",
  "late",
  "early_leave",
  "sick",
  "leave",
  "holiday",
] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];

export const ATTENDANCE_KIND_LABEL: Record<AttendanceKind, string> = {
  absent_justified: "Ausente (justif.)",
  absent_unjustified: "Ausente (injustif.)",
  late: "Tarde",
  early_leave: "Salida temprana",
  sick: "Enfermedad",
  leave: "Licencia",
  holiday: "Feriado",
};

export const ATTENDANCE_KIND_TONE: Record<AttendanceKind, string> = {
  absent_justified: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  absent_unjustified: "bg-rose-500/20 text-rose-700 dark:text-rose-300",
  late: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  early_leave: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  sick: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  leave: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  holiday: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export const ATTENDANCE_KIND_SHORT: Record<AttendanceKind, string> = {
  absent_justified: "AJ",
  absent_unjustified: "AI",
  late: "Ta",
  early_leave: "ET",
  sick: "Ef",
  leave: "Li",
  holiday: "Fe",
};

export function isAttendanceKind(value: unknown): value is AttendanceKind {
  return (
    typeof value === "string" &&
    (ATTENDANCE_KINDS as readonly string[]).includes(value)
  );
}

export const UpsertAttendanceSchema = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(ATTENDANCE_KINDS),
  hours_lost: z
    .union([z.literal(""), z.coerce.number().positive().max(24)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const DeleteAttendanceSchema = z.object({ id: z.string().uuid() });

export type UpsertAttendanceInput = z.infer<typeof UpsertAttendanceSchema>;

type AttendanceRow = Database["public"]["Tables"]["attendance_records"]["Row"];
export type AttendanceRecord = Omit<AttendanceRow, "kind" | "source"> & {
  kind: AttendanceKind;
  source: "manual" | "leave_sync" | "holiday_sync";
};

// ─── Holidays ────────────────────────────────────────────────────────────────

type HolidayRow = Database["public"]["Tables"]["holidays"]["Row"];
export type Holiday = HolidayRow;
