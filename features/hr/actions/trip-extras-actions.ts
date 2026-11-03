"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  TripRatesSchema,
  tripExtrasLines,
  type TripExtraLine,
  type TripExtrasSuggestion,
} from "../account-schema";
import { readEmployeeTrips } from "../lib/trip-extras";
import { formatPayrollPeriod } from "../payroll-schema";

// Extras desde viajes (roadmap 3.5): a suggestion over the month's completed
// trips and the employee's rates. Adding a line is an ordinary extra
// (addPayrollEntryExtraAction), editable like any other.

export type EntryTripExtras = TripExtrasSuggestion & {
  entry_id: string;
  employee_name: string;
  /** Concepts whose extra is already on the entry (same description start). */
  added: TripExtraLine["concept"][];
};

export type PeriodTripExtras = {
  rows: EntryTripExtras[];
  partial: boolean;
};

function addedPrefix(periodLabel: string): string {
  return `Viajes ${periodLabel}:`;
}

const CONCEPT_SUFFIX: Record<TripExtraLine["concept"], string> = {
  jornadas: " jornadas",
  km: " km",
  descargas: " descargas",
};

/** Suggested trip extras for every employee of the month's planilla with
 *  completed trips. */
export async function getPeriodTripExtrasAction(
  year: number,
  month: number,
): Promise<ActionResult<PeriodTripExtras>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver liquidaciones." };
  }
  const supabase = await createSupabaseClient();
  const { data: period, error: periodErr } = await supabase
    .from("payroll_periods")
    .select("id")
    .eq("year", year)
    .eq("month", month)
    .eq("kind", "monthly")
    .maybeSingle();
  if (periodErr) {
    return { ok: false, error: "No se pudo leer el período." };
  }
  if (!period) return { ok: true, data: { rows: [], partial: false } };

  const { data: entries, error: entriesErr } = await supabase
    .from("payroll_entries")
    .select(
      "id, employee_id, employee:employees ( legal_name, trip_rate_per_day, trip_rate_per_km, trip_rate_per_unload ), extras:payroll_entry_extras ( description )",
    )
    .eq("period_id", period.id);
  if (entriesErr) {
    logger.error("trip_extras.entries.failed", {
      userId: ctx.userId,
      error: entriesErr,
    });
    return { ok: false, error: "No se pudo leer la planilla." };
  }

  let trips: Awaited<ReturnType<typeof readEmployeeTrips>>;
  try {
    trips = await readEmployeeTrips(
      (entries ?? []).map((e) => e.employee_id),
      year,
      month,
    );
  } catch (error) {
    logger.error("trip_extras.trips.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los viajes del mes." };
  }

  const label = formatPayrollPeriod(year, month);
  const prefix = addedPrefix(label);
  const rows: EntryTripExtras[] = [];
  for (const entry of entries ?? []) {
    const list = trips.byEmployee.get(entry.employee_id) ?? [];
    if (list.length === 0) continue;
    const emp = entry.employee;
    const computed = tripExtrasLines(
      list,
      {
        trip_rate_per_day: numOrNull(emp?.trip_rate_per_day),
        trip_rate_per_km: numOrNull(emp?.trip_rate_per_km),
        trip_rate_per_unload: numOrNull(emp?.trip_rate_per_unload),
      },
      label,
    );
    const descriptions = (entry.extras ?? []).map((x) => x.description);
    const added = computed.lines
      .map((l) => l.concept)
      .filter((concept) =>
        descriptions.some(
          (d) => d.startsWith(prefix) && d.endsWith(CONCEPT_SUFFIX[concept]),
        ),
      );
    rows.push({
      entry_id: entry.id,
      employee_id: entry.employee_id,
      employee_name: emp?.legal_name ?? "(sin nombre)",
      trips: list,
      ...computed,
      added,
    });
  }
  rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name, "es-AR"));
  return { ok: true, data: { rows, partial: trips.partial } };
}

function numOrNull(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export async function updateTripRatesAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar empleados." };
  }
  const parsed = TripRatesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { employee_id, ...rates } = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employees")
    .update(rates)
    .eq("id", employee_id)
    .select("id");
  if (error) {
    logger.error("trip_rates.update.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron guardar las tarifas." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "El empleado ya no existe." };
  }
  await logAudit("employee.trip_rates_updated", ctx.userId, rates, employee_id);
  return { ok: true, data: undefined };
}
