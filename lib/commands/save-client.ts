import "server-only";

import type { z } from "zod";

import type {
  ClientCreateSchema,
  ClientUpdateSchema,
} from "@/features/clients/schema";
import { logAudit, type JsonValue } from "@/lib/actions/audit";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

const DUPLICATE_CUIT = "Ya existe un cliente con ese CUIT.";

/** No row matched: deleted meanwhile. */
export const CLIENT_NOT_FOUND =
  "No se encontró el cliente. Actualizá la página.";

/**
 * Inserts a client (Ventas with CUIT and IVA condition, or Otras ventas with
 * neither) and audits it. The caller has already checked `clients:write` and
 * parsed the input with `ClientCreateSchema`: the client dialog and an
 * accepted assistant proposal.
 */
export async function createClientRecord(
  actorId: string,
  d: z.output<typeof ClientCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { data, error } = await getServiceClient()
    .from("clients")
    .insert({
      is_fiscal: d.is_fiscal,
      cuit: d.is_fiscal ? d.cuit : null,
      legal_name: d.legal_name,
      display_name: d.display_name ?? null,
      iva_condition: d.is_fiscal ? d.iva_condition : null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      address: d.is_fiscal ? (d.address ?? null) : null,
      real_address: d.real_address ?? null,
      notes: d.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_CUIT };
    }
    logger.error("clients.create.failed", {
      userId: actorId,
      cuit: d.is_fiscal ? d.cuit : null,
      error,
    });
    return { ok: false, error: "No se pudo crear el cliente." };
  }

  await logAudit(
    "client.created",
    actorId,
    { cuit: d.is_fiscal ? d.cuit : null, legal_name: d.legal_name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

/**
 * Updates the given fields of a client and audits which ones. The caller has
 * already checked `clients:write` and parsed the input with
 * `ClientUpdateSchema`: the client dialog and an accepted assistant proposal.
 */
export async function updateClientRecord(
  actorId: string,
  d: z.output<typeof ClientUpdateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { id, ...rest } = d;

  const { data: changed, error } = await getServiceClient()
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
      ...(rest.real_address !== undefined && {
        real_address: rest.real_address ?? null,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes ?? null }),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_CUIT };
    }
    logger.error("clients.update.failed", { userId: actorId, id, error });
    return { ok: false, error: "No se pudo actualizar el cliente." };
  }
  if ((changed ?? []).length === 0) {
    return { ok: false, error: CLIENT_NOT_FOUND };
  }

  await logAudit(
    "client.updated",
    actorId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: { id } };
}
