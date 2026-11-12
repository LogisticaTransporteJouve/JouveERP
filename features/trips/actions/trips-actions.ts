"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { checkTripCompanion, createTrip } from "@/lib/commands/create-trip";
import {
  SHIPMENT_STATUS_SYNC_WARNING,
  setShipmentsTrip,
  syncShipmentTripStatus,
} from "@/lib/commands/set-shipments-trip";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  drainOrFirst,
  fetchInChunks,
  paginateRange,
} from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  TripCreateWithShipmentsSchema,
  TripListFilterSchema,
  TripUpdateSchema,
  type TripCompanionOption,
  type TripListFilter,
  isTripStatus,
  type Trip,
} from "../schema";

const SELECT_COLUMNS =
  "id, trip_date, driver_id, companion_employee_id, vehicle_id, channel_id, origin, destination, cargo_description, status, km, revenue, cost, notes, created_at, updated_at, driver:drivers(full_name), vehicle:vehicles(patente)";

type TripRow = {
  status: string;
  km: number | null;
  revenue: number | null;
  cost: number | null;
  companion_employee_id: string | null;
  [key: string]: unknown;
};

function narrow(
  row: TripRow,
  companions: ReadonlyMap<string, string>,
): Trip | null {
  if (!isTripStatus(row.status)) {
    logger.error("trips.unknown_enum", { status: row.status });
    return null;
  }
  const companionName = row.companion_employee_id
    ? companions.get(row.companion_employee_id)
    : undefined;
  return {
    ...row,
    km: row.km === null ? null : Number(row.km),
    revenue: row.revenue === null ? null : Number(row.revenue),
    cost: row.cost === null ? null : Number(row.cost),
    companion:
      companionName === undefined ? null : { legal_name: companionName },
  } as Trip;
}

/**
 * The rows as Trips with their Acompañante's name. Names are read with the
 * service client after the RLS read: a trips reader (operations, a driver)
 * has no hr:read, and only the names of the trips' own companions are read.
 * Null when that read fails, so a companion never shows as missing.
 */
async function narrowRows(
  rows: TripRow[],
  userId: string,
): Promise<Trip[] | null> {
  const ids = rows.flatMap((row) =>
    row.companion_employee_id ? [row.companion_employee_id] : [],
  );
  const res = await fetchInChunks(ids, (chunk) =>
    getServiceClient()
      .from("employees")
      .select("id, legal_name")
      .in("id", chunk),
  );
  if (res.error) {
    logger.error("trips.companions.failed", { userId, error: res.error });
    return null;
  }
  const companions = new Map(res.data.map((e) => [e.id, e.legal_name]));
  return rows
    .map((row) => narrow(row, companions))
    .filter((row): row is Trip => row !== null);
}

/** The ids of a trip's cargas, read with the service client so the status
 *  sync reaches every one of them; nothing of them is returned. */
async function tripShipmentIds(
  tripId: string,
  userId: string,
): Promise<string[] | null> {
  const service = getServiceClient();
  const res = await paginateRange((from, to) =>
    service
      .from("shipments")
      .select("id")
      .eq("trip_id", tripId)
      .order("id")
      .range(from, to),
  );
  if (res.error) {
    logger.error("trips.shipment_ids.failed", {
      userId,
      tripId,
      error: res.error,
    });
    return null;
  }
  return res.data.map((row) => row.id);
}

/** Every trip, newest first; `filter` narrows it (the page passes none). */
export async function listTripsAction(
  filter?: TripListFilter,
): Promise<ActionResult<Trip[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "trips:read")) {
    return { ok: false, error: "No tenés permiso para ver viajes." };
  }
  const parsed = TripListFilterSchema.safeParse(filter ?? {});
  if (!parsed.success) return { ok: false, error: "Filtros inválidos." };
  const f = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await drainOrFirst((from, to) => {
    let query = supabase.from("trips").select(SELECT_COLUMNS);
    if (f.from) query = query.gte("trip_date", f.from);
    if (f.to) query = query.lte("trip_date", f.to);
    if (f.vehicleId) query = query.eq("vehicle_id", f.vehicleId);
    if (f.driverId) query = query.eq("driver_id", f.driverId);
    return query
      .order("trip_date", { ascending: false })
      .order("id")
      .range(from, to);
  }, f.limit);
  if (error) {
    logger.error("trips.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los viajes." };
  }

  const rows = await narrowRows(data ?? [], ctx.userId);
  if (!rows) return { ok: false, error: "No se pudieron listar los viajes." };
  return { ok: true, data: rows };
}

export async function getTripAction(
  id: string,
): Promise<ActionResult<Trip | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "trips:read")) {
    return { ok: false, error: "No tenés permiso para ver viajes." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("trips")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("trips.get.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo cargar el viaje." };
  }
  if (!data) return { ok: true, data: null };
  const rows = await narrowRows([data], ctx.userId);
  if (!rows) return { ok: false, error: "No se pudo cargar el viaje." };
  return { ok: true, data: rows[0] ?? null };
}

/** Active employees the trip form offers as Acompañante: id and name only,
 *  read with the service client for whoever writes trips (no hr:read). */
export async function listTripCompanionOptionsAction(): Promise<
  ActionResult<TripCompanionOption[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "trips:write")) {
    return { ok: false, error: "No tenés permiso para editar viajes." };
  }
  const service = getServiceClient();
  const res = await paginateRange((from, to) =>
    service
      .from("employees")
      .select("id, legal_name")
      .eq("is_active", true)
      .order("legal_name")
      .order("id")
      .range(from, to),
  );
  if (res.error) {
    logger.error("trips.companion_options.failed", {
      userId: ctx.userId,
      error: res.error,
    });
    return { ok: false, error: "No se pudieron cargar los empleados." };
  }
  return { ok: true, data: res.data };
}

/**
 * Creates a trip and puts the picked cargas without a trip on it (which
 * starts them when the trip is dated today or earlier). An assignment that
 * fails after the insert keeps the trip: `assignError` says so and the
 * cargas can be assigned from the trip page.
 */
export async function createTripAction(input: unknown): Promise<
  ActionResult<{
    id: string;
    assigned: number;
    requested: number;
    assignError: string | null;
    warning: string | null;
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "trips:write")) {
    return { ok: false, error: "No tenés permiso para crear viajes." };
  }
  const parsed = TripCreateWithShipmentsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { shipment_ids: shipmentIds, ...trip } = parsed.data;
  if (
    shipmentIds.length > 0 &&
    !userCanAll(ctx.access, ["shipments:read", "shipments:write"])
  ) {
    return { ok: false, error: "No tenés permiso para asignar cargas." };
  }

  const supabase = await createSupabaseClient();
  const created = await createTrip(supabase, ctx.userId, trip);
  if (!created.ok) return created;
  const base = {
    id: created.data.id,
    assigned: 0,
    requested: shipmentIds.length,
    assignError: null,
    warning: null,
  };
  if (shipmentIds.length === 0) return { ok: true, data: base };

  const assigned = await setShipmentsTrip(supabase, ctx.userId, {
    tripId: created.data.id,
    shipmentIds,
  });
  if (!assigned.ok) {
    return { ok: true, data: { ...base, assignError: assigned.error } };
  }
  return {
    ok: true,
    data: {
      ...base,
      assigned: assigned.data.count,
      warning: assigned.data.warning,
    },
  };
}

/** Edits a trip; a new date or status brings its cargas' status in line
 *  (`warning` when that did not happen). */
export async function updateTripAction(
  input: unknown,
): Promise<ActionResult<{ warning: string | null }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "trips:write")) {
    return { ok: false, error: "No tenés permiso para editar viajes." };
  }
  const parsed = TripUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  if (rest.companion_employee_id) {
    // Only a new Acompañante must be active: the trip keeps one who left.
    const { data: current, error: readError } = await supabase
      .from("trips")
      .select("companion_employee_id")
      .eq("id", id)
      .maybeSingle();
    if (readError) {
      logger.error("trips.update.read_failed", {
        userId: ctx.userId,
        id,
        error: readError,
      });
      return { ok: false, error: "No se pudo actualizar el viaje." };
    }
    if (current?.companion_employee_id !== rest.companion_employee_id) {
      const companionError = await checkTripCompanion(
        rest.companion_employee_id,
        ctx.userId,
      );
      if (companionError) return { ok: false, error: companionError };
    }
  }
  const { data: changed, error } = await supabase
    .from("trips")
    .update({
      ...(rest.trip_date !== undefined && { trip_date: rest.trip_date }),
      ...(rest.driver_id !== undefined && { driver_id: rest.driver_id }),
      ...(rest.companion_employee_id !== undefined && {
        companion_employee_id: rest.companion_employee_id,
      }),
      ...(rest.vehicle_id !== undefined && { vehicle_id: rest.vehicle_id }),
      ...(rest.status !== undefined && { status: rest.status }),
    })
    .eq("id", id)
    .select("id");
  if (error) {
    // A trip with cargas in a live rendición keeps its driver.
    const guardError = mapDbGuardError(error, {
      slug: "trips.update.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("trips.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el viaje." };
  }
  if (!changed || changed.length === 0) {
    return { ok: false, error: "No se encontró el viaje." };
  }

  await logAudit(
    "trip.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  if (rest.trip_date === undefined && rest.status === undefined) {
    return { ok: true, data: { warning: null } };
  }
  const shipmentIds = await tripShipmentIds(id, ctx.userId);
  const warning = shipmentIds
    ? await syncShipmentTripStatus(shipmentIds, ctx.userId)
    : SHIPMENT_STATUS_SYNC_WARNING;
  return { ok: true, data: { warning } };
}

/** Deletes a trip; its cargas leave it (on delete set null) and go back to
 *  «No iniciada» if they had started (`warning` when that did not happen). */
export async function deleteTripAction(input: {
  id: string;
}): Promise<ActionResult<{ warning: string | null }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "trips:write")) {
    return { ok: false, error: "No tenés permiso para borrar viajes." };
  }
  // Read before the delete: afterwards nothing ties the cargas to the trip.
  const shipmentIds = await tripShipmentIds(input.id, ctx.userId);
  if (!shipmentIds) return { ok: false, error: "No se pudo borrar el viaje." };
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("trips")
    .delete()
    .eq("id", input.id)
    .select("id");
  if (error) {
    // Unlinking its cargas fails while one is in a live rendición.
    const guardError = mapDbGuardError(error, {
      slug: "trips.delete.rejected",
      userId: ctx.userId,
      id: input.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("trips.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el viaje." };
  }
  // RLS filters a row the role may not delete without an error.
  if (data.length === 0) {
    return { ok: false, error: "No se encontró el viaje o no podés borrarlo." };
  }
  await logAudit("trip.deleted", ctx.userId, {}, input.id);
  const warning = await syncShipmentTripStatus(shipmentIds, ctx.userId);
  return { ok: true, data: { warning } };
}
