"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { changeShipmentStatus } from "@/lib/commands/change-shipment-status";
import { createShipment } from "@/lib/commands/create-shipment";
import { setShipmentsTrip } from "@/lib/commands/set-shipments-trip";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { drainOrFirst, fetchInChunks } from "@/lib/supabase/paginate";
import { containsPattern } from "@/lib/supabase/like-pattern";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  ASSIGNABLE_SHIPMENT_STATUSES,
  ShipmentCreateSchema,
  ShipmentListFilterSchema,
  type ShipmentListFilter,
  ShipmentStatusChangeSchema,
  ShipmentTripAssignSchema,
  ShipmentUpdateSchema,
  isShipmentStatus,
  type Shipment,
  type ShipmentHistoryEntry,
} from "../schema";

const UNASSIGNED_LIMIT = 200;

const SELECT_COLUMNS =
  "id, client_id, trip_id, channel_id, remito_number, kind, origin, destination, description, scheduled_date, unload_date, time_window, status, delivery_date, failure_reason, freight_amount, invoice_id, notes, created_at, updated_at, client:clients(legal_name, display_name, cuit, iva_condition, is_fiscal), trip:trips(trip_date)";

type ShipmentRow = {
  status: string;
  freight_amount: number | null;
  invoice_id: string | null;
  [key: string]: unknown;
};

function narrow(
  row: ShipmentRow,
  voidInvoices: ReadonlySet<string>,
): Shipment | null {
  if (!isShipmentStatus(row.status)) {
    logger.error("shipments.unknown_enum", { status: row.status });
    return null;
  }
  return {
    ...row,
    freight_amount:
      row.freight_amount === null ? null : Number(row.freight_amount),
    invoice_void: row.invoice_id !== null && voidInvoices.has(row.invoice_id),
  } as Shipment;
}

/** The rows as Shipments, each marked when its invoice no longer bills it
 *  (billing_void_invoice_ids). Null when that read fails: a void invoice
 *  must not read as billing its carga. The rule is read with the service
 *  client, so a viewer who cannot read invoices (operations) gets the same
 *  answer guard_billed_shipment gives them; it only answers yes or no for
 *  the invoices of the cargas the viewer already read. */
async function narrowRows(
  rows: ShipmentRow[],
  userId: string,
): Promise<Shipment[] | null> {
  const invoiceIds = rows.flatMap((row) =>
    row.invoice_id === null ? [] : [row.invoice_id],
  );
  const service = getServiceClient();
  const voidRes = await fetchInChunks(invoiceIds, (ids) =>
    service.rpc("billing_void_invoice_ids", { p_invoice_ids: ids }),
  );
  if (voidRes.error) {
    logger.error("shipments.invoice_void.failed", {
      userId,
      error: voidRes.error,
    });
    return null;
  }
  const voidInvoices = new Set(voidRes.data);
  return rows
    .map((row) => narrow(row, voidInvoices))
    .filter((row): row is Shipment => row !== null);
}

/** Every carga, newest first; `filter` narrows it (the page passes the
 *  URL's filters). */
export async function listShipmentsAction(
  filter?: ShipmentListFilter,
): Promise<ActionResult<Shipment[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso para ver cargas." };
  }
  const parsed = ShipmentListFilterSchema.safeParse(filter ?? {});
  if (!parsed.success) return { ok: false, error: "Filtros inválidos." };
  const f = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await drainOrFirst((from, to) => {
    let query = supabase.from("shipments").select(SELECT_COLUMNS);
    if (f.from) query = query.gte("scheduled_date", f.from);
    if (f.to) query = query.lte("scheduled_date", f.to);
    if (f.id) query = query.eq("id", f.id);
    if (f.clientId) query = query.eq("client_id", f.clientId);
    if (f.tripId) query = query.eq("trip_id", f.tripId);
    if (f.statuses) query = query.in("status", f.statuses);
    if (f.assigned === true) query = query.not("trip_id", "is", null);
    if (f.assigned === false) query = query.is("trip_id", null);
    if (f.kinds) query = query.in("kind", f.kinds);
    if (f.remito) {
      query = query.ilike("remito_number", containsPattern(f.remito));
    }
    return query
      .order("scheduled_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);
  }, f.limit);
  if (error) {
    logger.error("shipments.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las cargas." };
  }
  const rows = await narrowRows(data ?? [], ctx.userId);
  if (!rows) return { ok: false, error: "No se pudieron listar las cargas." };
  return { ok: true, data: rows };
}

export async function listShipmentHistoryAction(
  shipmentId: string,
): Promise<ActionResult<ShipmentHistoryEntry[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("shipment_status_history")
    .select("id, old_status, new_status, comment, changed_at, changed_by")
    .eq("shipment_id", shipmentId)
    .order("changed_at", { ascending: false });
  if (error) {
    logger.error("shipments.history.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el historial." };
  }
  return { ok: true, data: data ?? [] };
}

export async function createShipmentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:write")) {
    return { ok: false, error: "No tenés permiso para crear cargas." };
  }
  const parsed = ShipmentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return createShipment(await createSupabaseClient(), ctx.userId, parsed.data);
}

export async function updateShipmentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:write")) {
    return { ok: false, error: "No tenés permiso para editar cargas." };
  }
  const parsed = ShipmentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .update({
      ...(rest.client_id !== undefined && { client_id: rest.client_id }),
      ...(rest.kind !== undefined && { kind: rest.kind }),
      ...(rest.origin !== undefined && { origin: rest.origin }),
      ...(rest.destination !== undefined && { destination: rest.destination }),
      ...(rest.description !== undefined && { description: rest.description }),
      ...(rest.scheduled_date !== undefined && {
        scheduled_date: rest.scheduled_date,
      }),
      ...(rest.unload_date !== undefined && {
        unload_date: rest.unload_date,
      }),
      ...(rest.time_window !== undefined && {
        time_window: rest.time_window,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id)
    .select("id");
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "shipments.update.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("shipments.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar la carga." };
  }
  if (data.length === 0) {
    return { ok: false, error: "No se encontró la carga." };
  }
  await logAudit(
    "shipment.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

/**
 * Changes a shipment's status (start / deliver / cancel / reprogram) and records
 * the transition in the append-only history. Deliver stamps delivery_date,
 * cancel/reprogram store the reason, reprogram can set a new scheduled date.
 */
export async function changeShipmentStatusAction(
  input: unknown,
): Promise<ActionResult<{ warning: string | null }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:write")) {
    return { ok: false, error: "No tenés permiso para cambiar el estado." };
  }
  const parsed = ShipmentStatusChangeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  // Putting the carga on a trip also edits the trip's cargas.
  if (parsed.data.trip_id && !userCan(ctx.access, "trips:write")) {
    return {
      ok: false,
      error: "No tenés permiso para asignar cargas a viajes.",
    };
  }
  return changeShipmentStatus(
    await createSupabaseClient(),
    ctx.userId,
    parsed.data,
  );
}

export async function deleteShipmentAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:write")) {
    return { ok: false, error: "No tenés permiso para borrar cargas." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .delete()
    .eq("id", input.id)
    .select("id");
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "shipments.delete.rejected",
      userId: ctx.userId,
      id: input.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("shipments.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la carga." };
  }
  // RLS filters a row the role may not delete without an error.
  if (data.length === 0) {
    return { ok: false, error: "No se encontró la carga o no podés borrarla." };
  }
  await logAudit("shipment.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}

/** Lists the cargas assigned to a trip (for the trip detail view). */
export async function listShipmentsByTripAction(
  tripId: string,
): Promise<ActionResult<Shipment[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso para ver cargas." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(SELECT_COLUMNS)
    .eq("trip_id", tripId)
    .order("scheduled_date", { ascending: true, nullsFirst: false });
  if (error) {
    logger.error("shipments.by_trip.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las cargas del viaje." };
  }
  const rows = await narrowRows(data ?? [], ctx.userId);
  if (!rows) {
    return { ok: false, error: "No se pudieron cargar las cargas del viaje." };
  }
  return { ok: true, data: rows };
}

/** Cargas without a trip that can still go on one (the trip's "Asignar"). */
export async function listUnassignedShipmentsAction(): Promise<
  ActionResult<Shipment[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso para ver cargas." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(SELECT_COLUMNS)
    .is("trip_id", null)
    .in("status", [...ASSIGNABLE_SHIPMENT_STATUSES])
    .order("scheduled_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(UNASSIGNED_LIMIT);
  if (error) {
    logger.error("shipments.unassigned.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las cargas sin viaje." };
  }
  const rows = await narrowRows(data ?? [], ctx.userId);
  if (!rows) {
    return { ok: false, error: "No se pudieron cargar las cargas sin viaje." };
  }
  return { ok: true, data: rows };
}

/**
 * Puts cargas on a trip, or takes them off it (tripId null), and syncs their
 * status (setShipmentsTrip). The count says how many moved; `warning` when
 * the status did not follow.
 */
export async function setShipmentsTripAction(
  input: unknown,
): Promise<ActionResult<{ count: number; warning: string | null }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:write")) {
    return { ok: false, error: "No tenés permiso para asignar cargas." };
  }
  const parsed = ShipmentTripAssignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const res = await setShipmentsTrip(
    await createSupabaseClient(),
    ctx.userId,
    parsed.data,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: { count: res.data.count, warning: res.data.warning },
  };
}
