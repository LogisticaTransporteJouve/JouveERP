"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import {
  CONCEPTO,
  DOC_TIPO,
  IVA_RATE,
  MONEDA,
  condicionIvaReceptorFor,
} from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { todayInAR } from "@/lib/format";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { isIvaCondition } from "@/features/clients/schema";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import {
  FreightInvoiceSchema,
  ShipmentCreateSchema,
  ShipmentStatusChangeSchema,
  ShipmentUpdateSchema,
  isShipmentStatus,
  type Shipment,
  type ShipmentHistoryEntry,
  type ShipmentStatus,
} from "../schema";
import { freightInvoiceDates } from "../lib/freight-invoice";

const SELECT_COLUMNS =
  "id, client_id, trip_id, channel_id, origin, destination, description, scheduled_date, status, delivery_date, failure_reason, freight_amount, invoice_id, notes, created_at, updated_at, client:clients(legal_name), trip:trips(trip_date)";

function narrow(row: {
  status: string;
  freight_amount: number | null;
  [key: string]: unknown;
}): Shipment | null {
  if (!isShipmentStatus(row.status)) {
    logger.error("shipments.unknown_enum", { status: row.status });
    return null;
  }
  return {
    ...row,
    freight_amount:
      row.freight_amount === null ? null : Number(row.freight_amount),
  } as Shipment;
}

export async function listShipmentsAction(): Promise<ActionResult<Shipment[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso para ver cargas." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(SELECT_COLUMNS)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("shipments.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las cargas." };
  }
  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is Shipment => row !== null);
  return { ok: true, data: rows };
}

type ShipmentOptions = {
  clients: { id: string; legal_name: string }[];
  trips: { id: string; trip_date: string; status: string }[];
  channels: { id: string; name: string }[];
};

/** Select options for the shipment form (clients, trips, channels). */
export async function listShipmentOptionsAction(): Promise<
  ActionResult<ShipmentOptions>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createSupabaseClient();
  const [clients, trips, channels] = await Promise.all([
    supabase.from("clients").select("id, legal_name").order("legal_name"),
    supabase
      .from("trips")
      .select("id, trip_date, status")
      .order("trip_date", { ascending: false })
      .limit(200),
    supabase.from("invoicing_channels").select("id, name").order("name"),
  ]);
  if (clients.error || trips.error || channels.error) {
    logger.error("shipments.options.failed", {
      userId: ctx.userId,
      error: clients.error ?? trips.error ?? channels.error,
    });
    return { ok: false, error: "No se pudieron cargar las opciones." };
  }
  return {
    ok: true,
    data: {
      clients: clients.data ?? [],
      trips: trips.data ?? [],
      channels: channels.data ?? [],
    },
  };
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
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .insert({
      client_id: parsed.data.client_id ?? null,
      trip_id: parsed.data.trip_id ?? null,
      channel_id: parsed.data.channel_id ?? null,
      origin: parsed.data.origin ?? null,
      destination: parsed.data.destination ?? null,
      description: parsed.data.description ?? null,
      scheduled_date: parsed.data.scheduled_date ?? null,
      freight_amount: parsed.data.freight_amount ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("shipments.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear la carga." };
  }
  await logAudit("shipment.created", ctx.userId, {}, data.id);
  return { ok: true, data: { id: data.id } };
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
  const { error } = await supabase
    .from("shipments")
    .update({
      ...(rest.client_id !== undefined && { client_id: rest.client_id }),
      ...(rest.trip_id !== undefined && { trip_id: rest.trip_id }),
      ...(rest.channel_id !== undefined && { channel_id: rest.channel_id }),
      ...(rest.origin !== undefined && { origin: rest.origin }),
      ...(rest.destination !== undefined && { destination: rest.destination }),
      ...(rest.description !== undefined && { description: rest.description }),
      ...(rest.scheduled_date !== undefined && {
        scheduled_date: rest.scheduled_date,
      }),
      ...(rest.freight_amount !== undefined && {
        freight_amount: rest.freight_amount,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("shipments.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar la carga." };
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
): Promise<ActionResult> {
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
  const { id, status, comment, delivery_date, failure_reason, scheduled_date } =
    parsed.data;

  const supabase = await createSupabaseClient();
  const { data: current, error: readErr } = await supabase
    .from("shipments")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !current) {
    return { ok: false, error: "No se encontró la carga." };
  }

  const today = todayInAR();
  const patch: {
    status: ShipmentStatus;
    delivery_date?: string;
    failure_reason?: string | null;
    scheduled_date?: string;
  } = { status };
  if (status === "delivered") {
    patch.delivery_date = delivery_date ?? today;
  }
  if (status === "cancelled" || status === "reprogrammed") {
    patch.failure_reason = failure_reason ?? null;
  }
  if (status === "reprogrammed" && scheduled_date) {
    patch.scheduled_date = scheduled_date;
  }

  const { error: updErr } = await supabase
    .from("shipments")
    .update(patch)
    .eq("id", id);
  if (updErr) {
    logger.error("shipments.status.update_failed", {
      userId: ctx.userId,
      error: updErr,
    });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  const { error: histErr } = await supabase
    .from("shipment_status_history")
    .insert({
      shipment_id: id,
      old_status: current.status,
      new_status: status,
      comment: comment ?? null,
      changed_by: ctx.userId,
    });
  if (histErr) {
    logger.error("shipments.status.history_failed", {
      userId: ctx.userId,
      error: histErr,
    });
  }

  await logAudit(
    "shipment.status_changed",
    ctx.userId,
    { from: current.status, to: status },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deleteShipmentAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:write")) {
    return { ok: false, error: "No tenés permiso para borrar cargas." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("shipments")
    .delete()
    .eq("id", input.id);
  if (error) {
    logger.error("shipments.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la carga." };
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
  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is Shipment => row !== null);
  return { ok: true, data: rows };
}

/**
 * "Facturar flete": issues a sales invoice for a shipment's freight, reusing the
 * proven issueFiscalInvoiceAction (handles fiscal AFIP vs internal per channel).
 * A single "Flete" service line at 21% IVA, billed to the shipment's client.
 * Links shipment.invoice_id on success so it can't be billed twice.
 */
export async function invoiceFreightAction(
  input: unknown,
): Promise<ActionResult<{ invoiceId: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "shipments:write") ||
    !userCan(ctx.access, "invoices:issue")
  ) {
    return { ok: false, error: "No tenés permiso para facturar el flete." };
  }
  const parsed = FreightInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data: shipment, error: readErr } = await supabase
    .from("shipments")
    .select(
      "id, client_id, origin, destination, freight_amount, invoice_id, scheduled_date, delivery_date, client:clients(cuit, iva_condition)",
    )
    .eq("id", parsed.data.shipmentId)
    .maybeSingle();
  if (readErr || !shipment) {
    return { ok: false, error: "No se encontró la carga." };
  }
  if (shipment.invoice_id) {
    return { ok: false, error: "La carga ya tiene una factura." };
  }
  const client = shipment.client;
  if (!shipment.client_id || !client?.cuit) {
    return { ok: false, error: "La carga necesita un cliente con CUIT." };
  }
  if (!shipment.freight_amount || Number(shipment.freight_amount) <= 0) {
    return { ok: false, error: "Cargá un monto de flete primero." };
  }
  if (!isIvaCondition(client.iva_condition)) {
    return { ok: false, error: "La condición de IVA del cliente es inválida." };
  }

  const dates = freightInvoiceDates(shipment, todayInAR());
  const ruta = [shipment.origin, shipment.destination]
    .filter(Boolean)
    .join(" → ");

  const result = await issueFiscalInvoiceAction({
    channel_id: parsed.data.channel_id,
    client_id: shipment.client_id,
    kind: "factura",
    letter: null,
    punto_venta: parsed.data.punto_venta,
    ...dates,
    concepto: CONCEPTO.SERVICIOS,
    doc_tipo: DOC_TIPO.CUIT,
    doc_nro: client.cuit,
    iva_condition_receptor: condicionIvaReceptorFor(client.iva_condition),
    moneda: MONEDA.PESOS,
    cotizacion: 1,
    items: [
      {
        description: ruta ? `Flete ${ruta}` : "Flete",
        quantity: 1,
        unit_price: Number(shipment.freight_amount),
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      },
    ],
  });
  if (!result.ok) return result;

  const { error: linkErr } = await supabase
    .from("shipments")
    .update({ invoice_id: result.data.id })
    .eq("id", parsed.data.shipmentId);
  if (linkErr) {
    logger.error("shipments.freight_invoice.link_failed", {
      userId: ctx.userId,
      shipmentId: parsed.data.shipmentId,
      invoiceId: result.data.id,
      error: linkErr,
    });
    return {
      ok: false,
      error:
        "La factura se emitió pero no se vinculó a la carga. Anotá el comprobante antes de volver a facturar.",
    };
  }
  await logAudit(
    "shipment.freight_invoiced",
    ctx.userId,
    { invoice_id: result.data.id },
    parsed.data.shipmentId,
  );
  return { ok: true, data: { invoiceId: result.data.id } };
}
