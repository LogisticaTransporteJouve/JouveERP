"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  ClientTariffCreateSchema,
  ClientTariffUpdateSchema,
  isClientTariffConcept,
  isClientTariffCurrency,
  isClientTariffUnit,
  type ClientTariff,
  type ClientTariffCreateInput,
  type ClientTariffUpdateInput,
} from "../schema";

type ClientTariffRow = Pick<
  Database["public"]["Tables"]["client_tariffs"]["Row"],
  | "id"
  | "client_id"
  | "concept"
  | "unit"
  | "price"
  | "currency"
  | "valid_from"
  | "valid_to"
  | "notes"
  | "created_at"
>;

const SELECT_COLUMNS =
  "id, client_id, concept, unit, price, currency, valid_from, valid_to, notes, created_at";

/** A row whose concept, unit or currency the app does not know is dropped
 *  and logged, not shown with a wrong label. */
function narrow(row: ClientTariffRow): ClientTariff | null {
  if (
    !isClientTariffConcept(row.concept) ||
    !isClientTariffUnit(row.unit) ||
    !isClientTariffCurrency(row.currency)
  ) {
    logger.error("client_tariffs.unknown_enum", {
      id: row.id,
      concept: row.concept,
      unit: row.unit,
      currency: row.currency,
    });
    return null;
  }
  return {
    ...row,
    concept: row.concept,
    unit: row.unit,
    currency: row.currency,
    price: Number(row.price),
  };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

/** The client's tariffs, newest vigencia first. Gated on storage_billing:read
 *  (pricing, like the general storage tariffs). */
export async function listClientTariffsAction(
  clientId: string,
): Promise<ActionResult<ClientTariff[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "storage_billing:read")) {
    return { ok: false, error: "No tenés permiso para ver tarifarios." };
  }
  const id = z.string().uuid().safeParse(clientId);
  if (!id.success) return { ok: false, error: "Cliente inválido." };

  const supabase = getServiceClient();
  // One client's tariffs: a handful of rows per concept, under max_rows.
  const { data, error } = await supabase
    .from("client_tariffs")
    .select(SELECT_COLUMNS)
    .eq("client_id", id.data)
    .order("concept")
    .order("valid_from", { ascending: false });
  if (error) {
    logger.error("client_tariffs.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el tarifario." };
  }
  return {
    ok: true,
    data: (data ?? []).map(narrow).filter((t): t is ClientTariff => t !== null),
  };
}

export async function createClientTariffAction(
  input: ClientTariffCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para editar tarifarios." };
  }
  const parsed = ClientTariffCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("client_tariffs")
    .insert({
      client_id: d.client_id,
      concept: d.concept,
      unit: d.unit,
      price: d.price,
      currency: d.currency,
      valid_from: d.valid_from,
      valid_to: d.valid_to ?? null,
      notes: d.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "client_tariffs.create.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("client_tariffs.create.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo crear la tarifa." };
  }

  await logAudit(
    "client_tariff.created",
    ctx.userId,
    {
      client_id: d.client_id,
      concept: d.concept,
      unit: d.unit,
      price: d.price,
      currency: d.currency,
      valid_from: d.valid_from,
      valid_to: d.valid_to ?? null,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateClientTariffAction(
  input: ClientTariffUpdateInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para editar tarifarios." };
  }
  const parsed = ClientTariffUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("client_tariffs")
    .update({
      concept: d.concept,
      unit: d.unit,
      price: d.price,
      currency: d.currency,
      valid_from: d.valid_from,
      valid_to: d.valid_to ?? null,
      notes: d.notes ?? null,
    })
    .eq("id", d.id)
    .select("id");
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "client_tariffs.update.rejected",
      userId: ctx.userId,
      id: d.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("client_tariffs.update.failed", {
      userId: ctx.userId,
      id: d.id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la tarifa." };
  }
  if (data.length === 0) {
    return { ok: false, error: "No se encontró la tarifa." };
  }

  await logAudit(
    "client_tariff.updated",
    ctx.userId,
    {
      concept: d.concept,
      unit: d.unit,
      price: d.price,
      currency: d.currency,
      valid_from: d.valid_from,
      valid_to: d.valid_to ?? null,
    },
    d.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteClientTariffAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para editar tarifarios." };
  }
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Tarifa inválida." };

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("client_tariffs")
    .delete()
    .eq("id", id.data)
    .select("id, client_id, concept, valid_from, valid_to");
  if (error) {
    logger.error("client_tariffs.delete.failed", {
      userId: ctx.userId,
      id: id.data,
      error,
    });
    return { ok: false, error: "No se pudo borrar la tarifa." };
  }
  const deleted = data[0];
  if (!deleted) return { ok: false, error: "No se encontró la tarifa." };

  await logAudit(
    "client_tariff.deleted",
    ctx.userId,
    {
      client_id: deleted.client_id,
      concept: deleted.concept,
      valid_from: deleted.valid_from,
      valid_to: deleted.valid_to,
    },
    id.data,
  );
  return { ok: true, data: undefined };
}
