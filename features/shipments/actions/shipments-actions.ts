"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { CONCEPTO, IVA_RATE, MONEDA, voucherReceptor } from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { readInvoicingChannels } from "@/lib/channels";
import { round2, todayInAR } from "@/lib/format";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { findSourceInvoiceSlot, invoiceIsVoid } from "@/lib/source-invoice-key";
import { fetchInChunks } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseClient>>;

import { isIvaCondition } from "@/features/clients/schema";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import {
  ASSIGNABLE_SHIPMENT_STATUSES,
  FreightInvoiceSchema,
  type FreightInvoiceInput,
  ShipmentCreateSchema,
  ShipmentRemitoCheckSchema,
  type ShipmentRemitoCheckInput,
  type ShipmentRemitoConflict,
  ShipmentStatusChangeSchema,
  ShipmentTripAssignSchema,
  ShipmentUpdateSchema,
  isShipmentStatus,
  type Shipment,
  type ShipmentHistoryEntry,
  type ShipmentStatus,
} from "../schema";
import { freightInvoiceDates } from "../lib/freight-invoice";

const UNASSIGNED_LIMIT = 200;

const SELECT_COLUMNS =
  "id, client_id, trip_id, channel_id, remito_number, origin,destination, description, scheduled_date, status, delivery_date, failure_reason, freight_amount, cod_amount, invoice_id, notes, created_at, updated_at, client:clients(legal_name, display_name, cuit, iva_condition, is_fiscal), trip:trips(trip_date)";

type ShipmentRow = {
  status: string;
  freight_amount: number | null;
  cod_amount: number | null;
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
    cod_amount: row.cod_amount === null ? null : Number(row.cod_amount),
    invoice_void: row.invoice_id !== null && voidInvoices.has(row.invoice_id),
  } as Shipment;
}

/** The rows as Shipments, each marked when its invoice no longer bills it
 *  (billing_void_invoice_ids). Null when that read fails: a void invoice
 *  must not read as billing its carga. */
async function narrowRows(
  supabase: SupabaseServerClient,
  rows: ShipmentRow[],
  userId: string,
): Promise<Shipment[] | null> {
  const invoiceIds = rows.flatMap((row) =>
    row.invoice_id === null ? [] : [row.invoice_id],
  );
  const voidRes = await fetchInChunks(invoiceIds, (ids) =>
    supabase.rpc("billing_void_invoice_ids", { p_invoice_ids: ids }),
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

const REMITO_UNIQUE_INDEX = "shipments_client_remito_unique";
const REMITO_TAKEN_ERROR =
  "Ese número de remito ya está en otra carga del cliente.";

/** The write hit the remito-per-client unique index. */
function isRemitoTaken(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  return (
    error?.code === PG_UNIQUE_VIOLATION &&
    (error.message ?? "").includes(REMITO_UNIQUE_INDEX)
  );
}

/**
 * The live carga of the client that already holds this remito number (the
 * one being edited aside), or null: the form warns before saving. The DB
 * index is what refuses the duplicate.
 */
export async function findShipmentRemitoConflictAction(
  input: ShipmentRemitoCheckInput,
): Promise<ActionResult<ShipmentRemitoConflict | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso para ver cargas." };
  }
  const parsed = ShipmentRemitoCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("shipment_remito_conflict", {
    p_client_id: parsed.data.client_id,
    p_remito_number: parsed.data.remito_number,
    ...(parsed.data.exclude_id ? { p_exclude_id: parsed.data.exclude_id } : {}),
  });
  if (error) {
    logger.error("shipments.remito_check.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo verificar el remito." };
  }
  const row = data?.[0];
  if (!row) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      id: row.id,
      scheduled_date: row.scheduled_date ?? null,
      status: row.status,
      origin: row.origin ?? null,
      destination: row.destination ?? null,
    },
  };
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
  const rows = await narrowRows(supabase, data ?? [], ctx.userId);
  if (!rows) return { ok: false, error: "No se pudieron listar las cargas." };
  return { ok: true, data: rows };
}

type ShipmentOptions = {
  trips: { id: string; trip_date: string; status: string }[];
  channels: { id: string; name: string; is_fiscal: boolean }[];
};

/** Select options for the shipment forms (recent trips, active channels).
 *  Clients are searched on demand with the client picker. */
export async function listShipmentOptionsAction(): Promise<
  ActionResult<ShipmentOptions>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createSupabaseClient();
  const [trips, channels] = await Promise.all([
    supabase
      .from("trips")
      .select("id, trip_date, status")
      .order("trip_date", { ascending: false })
      .limit(200),
    readInvoicingChannels(),
  ]);
  // Without channels «Facturar flete» has nothing to pick: an error, not an
  // empty select.
  if (trips.error || !channels.ok) {
    logger.error("shipments.options.failed", {
      userId: ctx.userId,
      error: trips.error ?? "invoicing_channels read failed",
    });
    return { ok: false, error: "No se pudieron cargar las opciones." };
  }
  return {
    ok: true,
    data: {
      trips: trips.data ?? [],
      channels: channels.channels
        .filter((c) => c.is_active)
        .map((c) => ({ id: c.id, name: c.name, is_fiscal: c.is_fiscal })),
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
      remito_number: parsed.data.remito_number ?? null,
      origin: parsed.data.origin ?? null,
      destination: parsed.data.destination ?? null,
      description: parsed.data.description ?? null,
      scheduled_date: parsed.data.scheduled_date ?? null,
      freight_amount: parsed.data.freight_amount ?? null,
      cod_amount: parsed.data.cod_amount ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (isRemitoTaken(error)) return { ok: false, error: REMITO_TAKEN_ERROR };
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
  const { data, error } = await supabase
    .from("shipments")
    .update({
      ...(rest.client_id !== undefined && { client_id: rest.client_id }),
      ...(rest.trip_id !== undefined && { trip_id: rest.trip_id }),
      ...(rest.channel_id !== undefined && { channel_id: rest.channel_id }),
      ...(rest.remito_number !== undefined && {
        remito_number: rest.remito_number,
      }),
      ...(rest.origin !== undefined && { origin: rest.origin }),
      ...(rest.destination !== undefined && { destination: rest.destination }),
      ...(rest.description !== undefined && { description: rest.description }),
      ...(rest.scheduled_date !== undefined && {
        scheduled_date: rest.scheduled_date,
      }),
      ...(rest.freight_amount !== undefined && {
        freight_amount: rest.freight_amount,
      }),
      ...(rest.cod_amount !== undefined && { cod_amount: rest.cod_amount }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id)
    .select("id");
  if (isRemitoTaken(error)) return { ok: false, error: REMITO_TAKEN_ERROR };
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
  // Out of cancelled, the carga takes its remito number back.
  if (isRemitoTaken(updErr)) {
    return { ok: false, error: REMITO_TAKEN_ERROR };
  }
  if (updErr) {
    // A carga in a live liquidación or rendición keeps its status.
    const guardError = mapDbGuardError(updErr, {
      slug: "shipments.status.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
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
  const rows = await narrowRows(supabase, data ?? [], ctx.userId);
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
  const rows = await narrowRows(supabase, data ?? [], ctx.userId);
  if (!rows) {
    return { ok: false, error: "No se pudieron cargar las cargas sin viaje." };
  }
  return { ok: true, data: rows };
}

/**
 * Puts cargas on a trip, or takes them off it (tripId null). Assigning only
 * takes cargas still without a trip, so two people assigning at once cannot
 * move a carga another trip already took; the count says how many moved.
 */
export async function setShipmentsTripAction(
  input: unknown,
): Promise<ActionResult<{ count: number }>> {
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
  const { tripId, shipmentIds } = parsed.data;
  const supabase = await createSupabaseClient();
  const base = supabase
    .from("shipments")
    .update({ trip_id: tripId })
    .in("id", shipmentIds);
  const { data, error } = await (
    tripId
      ? base.is("trip_id", null).in("status", [...ASSIGNABLE_SHIPMENT_STATUSES])
      : base
  ).select("id");
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "shipments.trip_set.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("shipments.trip_set.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron actualizar las cargas." };
  }
  for (const row of data) {
    await logAudit(
      "shipment.trip_set",
      ctx.userId,
      { trip_id: tripId },
      row.id,
    );
  }
  return { ok: true, data: { count: data.length } };
}

/**
 * "Facturar flete": issues a sales invoice for a shipment's freight, reusing the
 * proven issueFiscalInvoiceAction (handles fiscal AFIP vs internal per channel).
 * A single "Flete" service line at 21% IVA, billed to the shipment's client.
 * Claims the shipment first (claim_shipment_for_invoicing, which also frees a
 * carga whose invoice no longer bills it), so two concurrent clicks cannot
 * both issue, and issues under a key derived from
 * the carga (lib/source-invoice-key), so a click after an expired claim links
 * the invoice already issued; links invoice_id on success and releases the
 * claim on failure.
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
  const shipmentId = parsed.data.shipmentId;
  const claim = await claimShipmentForInvoicing(
    supabase,
    shipmentId,
    ctx.userId,
  );
  if (!claim.ok) return claim;
  // One live invoice per carga: one issued before a lost link is linked now
  // instead of issuing a second.
  const slot = await findSourceInvoiceSlot(
    supabase,
    "shipment_freight",
    shipmentId,
  );
  const result: ActionResult<{ id: string }> =
    slot.kind === "live"
      ? await reusableFreightInvoice(supabase, shipmentId, slot.invoiceId)
      : slot.kind === "free"
        ? await issueFreightInvoice(supabase, parsed.data, slot.key)
        : {
            ok: false,
            error:
              slot.kind === "error"
                ? "No se pudo verificar si la carga ya tiene factura."
                : "El flete se facturó demasiadas veces sin éxito: revisá sus comprobantes.",
          };
  const releaseClaim = async () => {
    const { error: releaseErr } = await supabase
      .from("shipments")
      .update({ invoicing_claimed_at: null })
      .eq("id", shipmentId)
      .is("invoice_id", null);
    if (releaseErr) {
      logger.error("shipments.freight_invoice.release_failed", {
        userId: ctx.userId,
        shipmentId,
        error: releaseErr,
      });
    }
  };
  if (!result.ok) {
    await releaseClaim();
    return result;
  }

  const { error: linkErr } = await supabase
    .from("shipments")
    .update({ invoice_id: result.data.id, invoicing_claimed_at: null })
    .eq("id", shipmentId);
  if (linkErr) {
    logger.error("shipments.freight_invoice.link_failed", {
      userId: ctx.userId,
      shipmentId,
      invoiceId: result.data.id,
      error: linkErr,
    });
    // The invoice no longer bills the carga (the link guard refuses it):
    // nothing bills the carga, so free it now.
    if (await invoiceIsVoid(supabase, result.data.id)) {
      await releaseClaim();
      return {
        ok: false,
        error:
          "La factura falló, se anuló o se acreditó por el total antes de vincularla a la carga: la carga quedó libre para facturarla de nuevo.",
      };
    }
    // Any other error keeps the claim; once it expires, "Facturar flete"
    // links this same invoice (its key is the carga's).
    return {
      ok: false,
      error:
        "La factura se emitió pero no se vinculó a la carga. En unos minutos volvé a facturar: se vincula la misma factura, sin emitir otra.",
    };
  }
  await logAudit(
    "shipment.freight_invoiced",
    ctx.userId,
    { invoice_id: result.data.id, reused: slot.kind === "live" },
    shipmentId,
  );
  return { ok: true, data: { invoiceId: result.data.id } };
}

/** claim_shipment_for_invoicing: claims an unbilled carga (a claim older
 *  than 15 minutes is abandoned), dropping first a link to an invoice that
 *  no longer bills it (a fiscal factura credited in full), which is
 *  audited. */
async function claimShipmentForInvoicing(
  supabase: SupabaseServerClient,
  shipmentId: string,
  userId: string,
): Promise<ActionResult> {
  const { data, error } = await supabase.rpc("claim_shipment_for_invoicing", {
    p_shipment_id: shipmentId,
  });
  if (error) {
    // A carga in a live liquidación is billed from the liquidación.
    const guardError = mapDbGuardError(error, {
      slug: "shipments.freight_invoice.claim_rejected",
      userId,
      id: shipmentId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("shipments.freight_invoice.claim_failed", {
      shipmentId,
      error,
    });
    return { ok: false, error: "No se pudo reservar la carga para facturar." };
  }
  const row = data?.[0];
  if (!row?.claimed) {
    return {
      ok: false,
      error: "La carga ya tiene una factura o se está facturando.",
    };
  }
  if (row.freed_invoice_id) {
    await logAudit(
      "shipment.invoice_unlinked",
      userId,
      { invoice_id: row.freed_invoice_id, reason: "invoice_void" },
      shipmentId,
    );
  }
  return { ok: true, data: undefined };
}

/** The invoice an earlier click issued for the carga, while it still bills
 *  the carga as it is: once the claim expires the carga can be edited, and
 *  an invoice for another client or flete is not its. */
async function reusableFreightInvoice(
  supabase: SupabaseServerClient,
  shipmentId: string,
  invoiceId: string,
): Promise<ActionResult<{ id: string }>> {
  const [shipment, invoice] = await Promise.all([
    supabase
      .from("shipments")
      .select("client_id, freight_amount")
      .eq("id", shipmentId)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("client_id, imp_neto")
      .eq("id", invoiceId)
      .maybeSingle(),
  ]);
  if (shipment.error || invoice.error || !shipment.data || !invoice.data) {
    logger.error("shipments.freight_invoice.reuse_read_failed", {
      shipmentId,
      invoiceId,
      error: shipment.error ?? invoice.error,
    });
    return {
      ok: false,
      error: "No se pudo verificar la factura ya emitida para la carga.",
    };
  }
  if (
    shipment.data.client_id !== invoice.data.client_id ||
    round2(Number(shipment.data.freight_amount ?? 0)) !==
      round2(Number(invoice.data.imp_neto))
  ) {
    return {
      ok: false,
      error:
        "La carga tiene una factura emitida sin vincular por otro cliente o flete: volvé la carga a esos datos para vincularla.",
    };
  }
  return { ok: true, data: { id: invoiceId } };
}

async function issueFreightInvoice(
  supabase: SupabaseServerClient,
  input: FreightInvoiceInput,
  idempotencyKey: string,
): Promise<ActionResult<{ id: string }>> {
  const { data: shipment, error: readErr } = await supabase
    .from("shipments")
    .select(
      "id, client_id, channel_id, origin, destination, freight_amount, invoice_id, scheduled_date, delivery_date, client:clients(cuit, iva_condition, is_fiscal)",
    )
    .eq("id", input.shipmentId)
    .maybeSingle();
  if (readErr || !shipment) {
    return { ok: false, error: "No se encontró la carga." };
  }
  if (shipment.invoice_id) {
    return { ok: false, error: "La carga ya tiene una factura." };
  }
  // A shipment booked on a channel is invoiced on that channel only.
  if (shipment.channel_id && shipment.channel_id !== input.channel_id) {
    return {
      ok: false,
      error:
        "La carga está cargada en otro canal: facturala en el canal de la carga.",
    };
  }
  const client = shipment.client;
  if (!shipment.client_id || !client) {
    return { ok: false, error: "La carga necesita un cliente." };
  }
  // An Otras ventas client has no CUIT: its freight goes on a remito interno.
  if (client.is_fiscal && !client.cuit) {
    return { ok: false, error: "La carga necesita un cliente con CUIT." };
  }
  if (!shipment.freight_amount || Number(shipment.freight_amount) <= 0) {
    return { ok: false, error: "Cargá un monto de flete primero." };
  }
  const ivaCondition = isIvaCondition(client.iva_condition)
    ? client.iva_condition
    : null;
  if (client.is_fiscal && !ivaCondition) {
    return { ok: false, error: "La condición de IVA del cliente es inválida." };
  }

  const dates = freightInvoiceDates(shipment, todayInAR());
  const ruta = [shipment.origin, shipment.destination]
    .filter(Boolean)
    .join(" → ");

  return issueFiscalInvoiceAction({
    channel_id: input.channel_id,
    client_id: shipment.client_id,
    kind: "factura",
    letter: null,
    punto_venta: input.punto_venta,
    ...dates,
    concepto: CONCEPTO.SERVICIOS,
    ...voucherReceptor({ cuit: client.cuit, iva_condition: ivaCondition }),
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
    idempotency_key: idempotencyKey,
  });
}
