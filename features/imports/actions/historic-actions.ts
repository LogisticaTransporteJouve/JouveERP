"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  HISTORIC_PAYROLL_KINDS,
  HISTORIC_READ_PERMISSION,
  HistoricPayrollListSchema,
  HistoricTripsListSchema,
  type HistoricPayrollKind,
} from "../schema";

// The historic rows are read here and nowhere else: they are reference data
// from before the go-live (supabase/migrations/20261103110000_import_runs.sql).

function isHistoricPayrollKind(value: unknown): value is HistoricPayrollKind {
  return (
    typeof value === "string" &&
    (HISTORIC_PAYROLL_KINDS as readonly string[]).includes(value)
  );
}

export type HistoricPayrollEntry = {
  id: string;
  employee_name: string;
  employee_cuil: string | null;
  period: string;
  kind: HistoricPayrollKind;
  net_amount: number;
  paid_amount: number | null;
  paid_on: string | null;
  notes: string | null;
};

export type HistoricPeriodTotal = {
  period: string;
  entries: number;
  net: number;
  /** Sum of the rows that say what was paid; null when none does. */
  paid: number | null;
};

export type HistoricPayrollYear = {
  entries: HistoricPayrollEntry[];
  totals: HistoricPeriodTotal[];
};

/** A year of historic payroll, by period and employee, with each period's
 *  totals. */
export async function listHistoricPayrollAction(
  input: unknown,
): Promise<ActionResult<HistoricPayrollYear>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "imports:read") ||
    !userCan(ctx.access, HISTORIC_READ_PERMISSION.historic_payroll)
  ) {
    return { ok: false, error: "No tenés permiso para ver los sueldos." };
  }
  const parsed = HistoricPayrollListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Año inválido." };

  const service = getServiceClient();
  const { data, error } = await paginateRange((from, to) =>
    service
      .from("historic_payroll_entries")
      .select(
        "id, period, kind, net_amount, paid_amount, paid_on, notes, employees ( legal_name, cuil )",
      )
      .like("period", `${parsed.data.year}-%`)
      .order("period")
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("imports.historic_payroll.list_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer los sueldos históricos." };
  }

  const entries = data.flatMap((r): HistoricPayrollEntry[] =>
    isHistoricPayrollKind(r.kind)
      ? [
          {
            id: r.id,
            employee_name: r.employees?.legal_name ?? "—",
            employee_cuil: r.employees?.cuil ?? null,
            period: r.period,
            kind: r.kind,
            net_amount: Number(r.net_amount),
            paid_amount: r.paid_amount === null ? null : Number(r.paid_amount),
            paid_on: r.paid_on,
            notes: r.notes,
          },
        ]
      : [],
  );
  entries.sort(
    (a, b) =>
      a.period.localeCompare(b.period) ||
      a.kind.localeCompare(b.kind) ||
      a.employee_name.localeCompare(b.employee_name, "es"),
  );

  const byPeriod = new Map<string, HistoricPeriodTotal>();
  for (const e of entries) {
    const t = byPeriod.get(e.period) ?? {
      period: e.period,
      entries: 0,
      net: 0,
      paid: null,
    };
    t.entries += 1;
    t.net = round2(t.net + e.net_amount);
    if (e.paid_amount !== null) t.paid = round2((t.paid ?? 0) + e.paid_amount);
    byPeriod.set(e.period, t);
  }
  return { ok: true, data: { entries, totals: [...byPeriod.values()] } };
}

export type HistoricTrip = {
  id: string;
  trip_date: string;
  vehicle: string | null;
  driver: string | null;
  client: string | null;
  origin: string | null;
  destination: string | null;
  km: number | null;
  freight_amount: number | null;
  notes: string | null;
};

export type HistoricTripsMonth = {
  trips: HistoricTrip[];
  totals: { trips: number; km: number; freight: number };
};

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** A month of historic trips with its totals (km and freight in pesos). */
export async function listHistoricTripsAction(
  input: unknown,
): Promise<ActionResult<HistoricTripsMonth>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "imports:read") ||
    !userCan(ctx.access, HISTORIC_READ_PERMISSION.historic_trips)
  ) {
    return { ok: false, error: "No tenés permiso para ver los viajes." };
  }
  const parsed = HistoricTripsListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Mes inválido." };
  const { month } = parsed.data;

  const service = getServiceClient();
  const { data, error } = await paginateRange((from, to) =>
    service
      .from("historic_trips")
      .select(
        "id, trip_date, vehicle_label, driver_label, client_label, origin, destination, km, freight_amount, notes, vehicles ( patente ), drivers ( full_name ), clients ( legal_name )",
      )
      .gte("trip_date", `${month}-01`)
      .lte("trip_date", monthEnd(month))
      .order("trip_date")
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("imports.historic_trips.list_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer los viajes históricos." };
  }

  const trips: HistoricTrip[] = data.map((t) => ({
    id: t.id,
    trip_date: t.trip_date,
    vehicle: t.vehicles?.patente ?? t.vehicle_label,
    driver: t.drivers?.full_name ?? t.driver_label,
    client: t.clients?.legal_name ?? t.client_label,
    origin: t.origin,
    destination: t.destination,
    km: t.km === null ? null : Number(t.km),
    freight_amount: t.freight_amount === null ? null : Number(t.freight_amount),
    notes: t.notes,
  }));
  const totals = trips.reduce(
    (acc, t) => ({
      trips: acc.trips + 1,
      km: Math.round((acc.km + (t.km ?? 0)) * 10) / 10,
      freight: round2(acc.freight + (t.freight_amount ?? 0)),
    }),
    { trips: 0, km: 0, freight: 0 },
  );
  return { ok: true, data: { trips, totals } };
}
