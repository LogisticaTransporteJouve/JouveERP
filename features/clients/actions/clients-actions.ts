"use server";

import { revalidatePath } from "next/cache";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  CLIENTS_PATH,
  ClientCreateSchema,
  ClientToggleActiveSchema,
  ClientUpdateSchema,
  isIvaCondition,
  type Client,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

const UNIQUE_VIOLATION = "23505";

async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    event_type: eventType,
    target_resource_id: targetResourceId ?? null,
    payload,
  });
  if (error) {
    logger.error("audit.insert.failed", { eventType, error });
  }
}

function narrowClient(row: {
  iva_condition: string;
  [key: string]: unknown;
}): Client | null {
  if (!isIvaCondition(row.iva_condition)) {
    logger.error("clients.unknown_iva_condition", {
      value: row.iva_condition,
    });
    return null;
  }
  return row as unknown as Client;
}

export async function listClientsAction(): Promise<ActionResult<Client[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, cuit, legal_name, display_name, iva_condition, email, phone, address, notes, is_active, created_by, created_at, updated_at",
    )
    .order("legal_name");

  if (error) {
    logger.error("clients.list.failed", { error });
    return { ok: false, error: "No se pudo listar los clientes." };
  }

  const clients = (data ?? [])
    .map((row) => narrowClient(row))
    .filter((row): row is Client => row !== null);

  return { ok: true, data: clients };
}

export async function createClientAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:write")) {
    return { ok: false, error: "No tenés permiso para crear clientes." };
  }

  const parsed = ClientCreateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      cuit: parsed.data.cuit,
      legal_name: parsed.data.legal_name,
      display_name: parsed.data.display_name ?? null,
      iva_condition: parsed.data.iva_condition,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya existe un cliente con ese CUIT." };
    }
    logger.error("clients.create.failed", { error });
    return { ok: false, error: "No se pudo crear el cliente." };
  }

  await logAudit(
    "client.created",
    ctx.userId,
    { cuit: parsed.data.cuit, legal_name: parsed.data.legal_name },
    data.id,
  );
  revalidatePath(CLIENTS_PATH);
  return { ok: true, data: { id: data.id } };
}

export async function updateClientAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:write")) {
    return { ok: false, error: "No tenés permiso para editar clientes." };
  }

  const parsed = ClientUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .update({
      ...(rest.cuit !== undefined && { cuit: rest.cuit }),
      ...(rest.legal_name !== undefined && { legal_name: rest.legal_name }),
      ...(rest.display_name !== undefined && {
        display_name: rest.display_name ?? null,
      }),
      ...(rest.iva_condition !== undefined && {
        iva_condition: rest.iva_condition,
      }),
      ...(rest.email !== undefined && { email: rest.email ?? null }),
      ...(rest.phone !== undefined && { phone: rest.phone ?? null }),
      ...(rest.address !== undefined && { address: rest.address ?? null }),
      ...(rest.notes !== undefined && { notes: rest.notes ?? null }),
    })
    .eq("id", id);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya existe un cliente con ese CUIT." };
    }
    logger.error("clients.update.failed", { error });
    return { ok: false, error: "No se pudo actualizar el cliente." };
  }

  await logAudit(
    "client.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  revalidatePath(CLIENTS_PATH);
  return { ok: true, data: undefined };
}

export async function setClientActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:write")) {
    return { ok: false, error: "No tenés permiso para editar clientes." };
  }

  const parsed = ClientToggleActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);

  if (error) {
    logger.error("clients.toggle_active.failed", { error });
    return { ok: false, error: "No se pudo cambiar el estado del cliente." };
  }

  await logAudit(
    parsed.data.is_active ? "client.reactivated" : "client.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  revalidatePath(CLIENTS_PATH);
  return { ok: true, data: undefined };
}
