import "server-only";

import type { createClient } from "@/lib/supabase/server";

import {
  currentVacationPeriodYear,
  vacationPeriodWindow,
} from "./vacation-periods";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

type BalanceRow = {
  id: string;
  period_year: number;
  bonus_days: number;
  carryover_days: number;
  used_days: number;
  status: string;
};

export type VacationOpening = {
  employeeId: string;
  /** Days of the period in course; null leaves that period untouched. */
  currentDays: number | null;
  /** Days still pending from earlier years; null leaves them untouched. */
  previousDays: number | null;
  today: string;
  userId: string;
};

type Result = { ok: true; periodYear: number } | { ok: false; error: string };

/**
 * Writes the vacation days HR loads by hand on the employee's balance rows.
 *
 * - The period in course gets `currentDays` as its days (entitled + extra).
 * - Days pending from earlier years land on the previous period's row,
 *   marked `extended` so they stay usable after April 30; leaves consume it
 *   first (apply_vacation_delta takes the oldest open period first).
 *
 * Both are written so the balance shows exactly the figure entered, net of
 * the days already used on that row. Runs with the caller's client: the
 * balances' RLS lets only owner/admin write.
 */
export async function applyVacationOpening(
  supabase: ServerClient,
  opening: VacationOpening,
): Promise<Result> {
  const periodYear = currentVacationPeriodYear(opening.today);
  const { data, error } = await supabase
    .from("employee_vacation_balances")
    .select("id, period_year, bonus_days, carryover_days, used_days, status")
    .eq("employee_id", opening.employeeId)
    .in("period_year", [periodYear, periodYear - 1]);
  if (error) return { ok: false, error: "No se pudo leer el saldo actual." };
  const rows: BalanceRow[] = data ?? [];
  const byYear = new Map(rows.map((r) => [r.period_year, r]));

  const currentDays = opening.currentDays;
  if (currentDays !== null) {
    const written = await writePeriod(supabase, {
      row: byYear.get(periodYear),
      employeeId: opening.employeeId,
      periodYear,
      // The period's own days: what was already used still counts against it.
      entitled: (r) => currentDays - r.bonus_days,
      status: () => "active",
      insertStatus: "active",
      notes: "Días del período cargados a mano",
      userId: opening.userId,
      initialEntitled: currentDays,
    });
    if (!written.ok) return written;
  }

  if (opening.previousDays !== null) {
    const pending = opening.previousDays;
    const row = byYear.get(periodYear - 1);
    if (row || pending > 0) {
      const written = await writePeriod(supabase, {
        row,
        employeeId: opening.employeeId,
        periodYear: periodYear - 1,
        // What is left to take equals the figure entered.
        entitled: (r) =>
          pending + r.used_days - r.bonus_days - r.carryover_days,
        status: (r) =>
          pending > 0
            ? "extended"
            : r.status === "extended"
              ? "expired"
              : r.status,
        insertStatus: "extended",
        notes: "Días pendientes de años anteriores cargados a mano",
        userId: opening.userId,
        initialEntitled: pending,
      });
      if (!written.ok) return written;
    }
  }

  return { ok: true, periodYear };
}

async function writePeriod(
  supabase: ServerClient,
  args: {
    row: BalanceRow | undefined;
    employeeId: string;
    periodYear: number;
    entitled: (row: BalanceRow) => number;
    status: (row: BalanceRow) => string;
    /** Status of a row created here: `extended` keeps earlier days usable
     *  after their April 30. */
    insertStatus: "active" | "extended";
    notes: string;
    userId: string;
    initialEntitled: number;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (args.row) {
    const entitled = args.entitled(args.row);
    if (entitled < 0) {
      return {
        ok: false,
        error: `El período ${args.periodYear} ya tiene más días tomados o asignados que los que querés cargar.`,
      };
    }
    const { data, error } = await supabase
      .from("employee_vacation_balances")
      .update({ entitled_days: entitled, status: args.status(args.row) })
      .eq("id", args.row.id)
      .select("id");
    if (error || !data || data.length === 0) {
      return { ok: false, error: "No se pudo guardar el saldo de vacaciones." };
    }
    return { ok: true };
  }

  const window = vacationPeriodWindow(args.periodYear);
  const { error } = await supabase.from("employee_vacation_balances").insert({
    employee_id: args.employeeId,
    period_year: args.periodYear,
    entitled_days: args.initialEntitled,
    granted_at: window.granted_at,
    expires_at: window.expires_at,
    status: args.insertStatus,
    notes: args.notes,
    created_by: args.userId,
  });
  if (error) {
    return { ok: false, error: "No se pudo guardar el saldo de vacaciones." };
  }
  return { ok: true };
}
