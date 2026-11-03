"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  PalletBlockSchema,
  PalletBulkCreateSchema,
  PalletBulkDispatchSchema,
  PalletCreateSchema,
  PalletUpdateSchema,
  isPalletStatus,
  type Pallet,
  type PalletBlockInput,
} from "../schema";

type PalletSelectRow = Pick<
  Database["public"]["Tables"]["pallets"]["Row"],
  | "id"
  | "warehouse_id"
  | "client_id"
  | "product_id"
  | "code"
  | "quantity"
  | "status"
  | "entry_date"
  | "exit_date"
  | "notes"
  | "area_id"
  | "lot_number"
  | "lot_expiry"
  | "blocked_at"
  | "blocked_by"
  | "block_reason"
  | "created_at"
  | "updated_at"
> & {
  warehouse: { name: string } | null;
  client: { legal_name: string } | null;
  product: { name: string } | null;
  area: { name: string } | null;
};

function narrow(row: PalletSelectRow): Pallet | null {
  if (!isPalletStatus(row.status)) {
    logger.error("pallets.unknown_status", { status: row.status });
    return null;
  }
  return {
    ...row,
    status: row.status,
    quantity: row.quantity === null ? null : Number(row.quantity),
  };
}

const SELECT_COLUMNS =
  "id, warehouse_id, client_id, product_id, code, quantity, status, entry_date, exit_date, notes, area_id, lot_number, lot_expiry, blocked_at, blocked_by, block_reason, created_at, updated_at, warehouse:warehouses(name), client:clients(legal_name), product:products(name), area:storage_areas(name)";

/** A pallet write the database refused: a guard (a blocked pallet), an area
 *  of another warehouse (the composite FK) or a repeated code. */
function palletWriteError(
  error: { code?: string | null; message: string; hint?: string | null },
  slug: string,
  userId: string,
  id?: string,
): string | null {
  const guard = mapDbGuardError(error, { slug, userId, id });
  if (guard) return guard;
  if (error.code === PG_UNIQUE_VIOLATION) {
    return "Ya existe un pallet con ese código.";
  }
  if (error.code === PG_FOREIGN_KEY_VIOLATION) {
    return "El área no es del depósito del pallet.";
  }
  return null;
}

export async function listPalletsAction(): Promise<ActionResult<Pallet[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:read")) {
    return { ok: false, error: "No tenés permiso para ver pallets." };
  }
  // Service client after the gate: the embedded client name sits behind the
  // clients RLS, which leaves the warehouse role out ("—" in every row).
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("pallets")
    .select(SELECT_COLUMNS)
    .order("entry_date", { ascending: false });
  if (error) {
    logger.error("pallets.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los pallets." };
  }

  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is Pallet => row !== null);
  return { ok: true, data: rows };
}

/** Clients a pallet can belong to (id + name), for the pallet pickers. The
 *  warehouse role loads pallets but cannot read the clients module, so the
 *  picker reads through the service client after the pallets gate. */
export async function listPalletClientOptionsAction(): Promise<
  ActionResult<{ id: string; legal_name: string }[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:read")) {
    return { ok: false, error: "No tenés permiso para ver pallets." };
  }
  const { data, error } = await getServiceClient()
    .from("clients")
    .select("id, legal_name")
    .eq("is_active", true)
    .order("legal_name");
  if (error) {
    logger.error("pallets.client_options.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron cargar los clientes." };
  }
  return { ok: true, data: data ?? [] };
}

export async function createPalletAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:write")) {
    return { ok: false, error: "No tenés permiso para crear pallets." };
  }
  const parsed = PalletCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("pallets")
    .insert({
      warehouse_id: parsed.data.warehouse_id,
      client_id: parsed.data.client_id,
      product_id: parsed.data.product_id ?? null,
      code: parsed.data.code,
      quantity: parsed.data.quantity ?? null,
      status: parsed.data.status,
      entry_date: parsed.data.entry_date,
      exit_date: parsed.data.exit_date ?? null,
      notes: parsed.data.notes ?? null,
      area_id: parsed.data.area_id ?? null,
      lot_number: parsed.data.lot_number ?? null,
      lot_expiry: parsed.data.lot_expiry ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    const known = palletWriteError(
      error,
      "pallets.create.rejected",
      ctx.userId,
    );
    if (known) return { ok: false, error: known };
    logger.error("pallets.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el pallet." };
  }

  await logAudit(
    "pallet.created",
    ctx.userId,
    { code: parsed.data.code },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

/** Creates many pallets at once (shared fields + one per code). */
export async function createPalletsBulkAction(
  input: unknown,
): Promise<ActionResult<{ created: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:write")) {
    return { ok: false, error: "No tenés permiso para crear pallets." };
  }
  const parsed = PalletBulkCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { count, code_prefix } = parsed.data;
  const supabase = await createSupabaseClient();

  // Continue the numeric sequence for this prefix so codes are unique + ordered.
  const { data: existing, error: seqError } = await supabase
    .from("pallets")
    .select("code")
    .like("code", `${code_prefix}-%`);
  if (seqError) {
    logger.error("pallets.bulk_create.seq_failed", {
      userId: ctx.userId,
      error: seqError,
    });
    return { ok: false, error: "No se pudieron generar los códigos." };
  }
  const seqRe = new RegExp(`^${code_prefix}-(\\d+)$`);
  let maxSeq = 0;
  for (const row of existing ?? []) {
    const match = seqRe.exec(row.code);
    if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
  }
  const start = maxSeq + 1;
  const pad = Math.max(4, String(start + count - 1).length);
  const codes = Array.from(
    { length: count },
    (_, i) => `${code_prefix}-${String(start + i).padStart(pad, "0")}`,
  );

  const rows = codes.map((code) => ({
    warehouse_id: parsed.data.warehouse_id,
    client_id: parsed.data.client_id,
    product_id: parsed.data.product_id ?? null,
    code,
    quantity: parsed.data.quantity ?? null,
    status: "en_deposito",
    entry_date: parsed.data.entry_date,
    notes: parsed.data.notes ?? null,
    area_id: parsed.data.area_id ?? null,
    lot_number: parsed.data.lot_number ?? null,
    lot_expiry: parsed.data.lot_expiry ?? null,
    created_by: ctx.userId,
  }));

  const { data, error } = await supabase
    .from("pallets")
    .insert(rows)
    .select("id");
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Se generó un código repetido, volvé a intentar.",
      };
    }
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return { ok: false, error: "El área no es del depósito de los pallets." };
    }
    logger.error("pallets.bulk_create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron crear los pallets." };
  }
  const created = data?.length ?? codes.length;
  await logAudit("pallet.bulk_created", ctx.userId, { count: created });
  return { ok: true, data: { created } };
}

/**
 * Bulk OUT: mark the selected pallets as despachado with an exit date. Only
 * pallets still en_deposito and not blocked are dispatched (idempotent re-runs
 * are no-ops); the blocked ones are counted and left in place. The exit date
 * drives storage-billing: it caps the stored days and triggers the descarga
 * (handling_out) charge for the period it falls in.
 */
export async function dispatchPalletsBulkAction(
  input: unknown,
): Promise<ActionResult<{ dispatched: number; blocked: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:write")) {
    return { ok: false, error: "No tenés permiso para despachar pallets." };
  }
  const parsed = PalletBulkDispatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { ids, exit_date } = parsed.data;

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("pallets")
    .update({ status: "despachado", exit_date })
    .in("id", ids)
    .eq("status", "en_deposito")
    .is("blocked_at", null)
    .select("id");
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "pallets.bulk_dispatch.rejected",
      userId: ctx.userId,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("pallets.bulk_dispatch.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron despachar los pallets." };
  }
  const dispatched = data?.length ?? 0;
  const { count: blocked, error: blockedErr } = await supabase
    .from("pallets")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .not("blocked_at", "is", null);
  if (blockedErr) {
    logger.error("pallets.bulk_dispatch.blocked_count_failed", {
      userId: ctx.userId,
      error: blockedErr,
    });
  }
  await logAudit("pallet.bulk_dispatched", ctx.userId, {
    count: dispatched,
    blocked: blocked ?? 0,
  });
  return { ok: true, data: { dispatched, blocked: blocked ?? 0 } };
}

export async function updatePalletAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:write")) {
    return { ok: false, error: "No tenés permiso para editar pallets." };
  }
  const parsed = PalletUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("pallets")
    .update({
      ...(rest.warehouse_id !== undefined && {
        warehouse_id: rest.warehouse_id,
      }),
      ...(rest.client_id !== undefined && { client_id: rest.client_id }),
      ...(rest.product_id !== undefined && { product_id: rest.product_id }),
      ...(rest.code !== undefined && { code: rest.code }),
      ...(rest.quantity !== undefined && { quantity: rest.quantity }),
      ...(rest.status !== undefined && { status: rest.status }),
      ...(rest.entry_date !== undefined && { entry_date: rest.entry_date }),
      ...(rest.exit_date !== undefined && { exit_date: rest.exit_date }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
      ...(rest.area_id !== undefined && { area_id: rest.area_id }),
      ...(rest.lot_number !== undefined && { lot_number: rest.lot_number }),
      ...(rest.lot_expiry !== undefined && { lot_expiry: rest.lot_expiry }),
    })
    .eq("id", id);
  if (error) {
    const known = palletWriteError(
      error,
      "pallets.update.rejected",
      ctx.userId,
      id,
    );
    if (known) return { ok: false, error: known };
    logger.error("pallets.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar el pallet." };
  }

  await logAudit(
    "pallet.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deletePalletAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:write")) {
    return { ok: false, error: "No tenés permiso para borrar pallets." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("pallets").delete().eq("id", input.id);
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "pallets.delete.rejected",
      userId: ctx.userId,
      id: input.id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("pallets.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el pallet." };
  }
  await logAudit("pallet.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}

/**
 * Blocks a pallet en depósito: it cannot be dispatched nor deleted until it is
 * unblocked (guard_pallet_blocked). Records who and why.
 */
export async function blockPalletAction(
  input: PalletBlockInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:write")) {
    return { ok: false, error: "No tenés permiso para bloquear pallets." };
  }
  const parsed = PalletBlockSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, reason } = parsed.data;

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("pallets")
    .update({
      blocked_at: new Date().toISOString(),
      blocked_by: ctx.userId,
      block_reason: reason,
    })
    .eq("id", id)
    .is("blocked_at", null)
    .select("id");
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "pallets.block.rejected",
      userId: ctx.userId,
      id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("pallets.block.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo bloquear el pallet." };
  }
  if (data.length === 0) {
    return { ok: false, error: "El pallet no existe o ya está bloqueado." };
  }

  await logAudit("pallet.blocked", ctx.userId, { reason }, id);
  return { ok: true, data: undefined };
}

export async function unblockPalletAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:write")) {
    return { ok: false, error: "No tenés permiso para desbloquear pallets." };
  }
  const id = PalletBlockSchema.shape.id.safeParse(input.id);
  if (!id.success) return { ok: false, error: "Pallet inválido." };

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("pallets")
    .update({ blocked_at: null, blocked_by: null, block_reason: null })
    .eq("id", id.data)
    .not("blocked_at", "is", null)
    .select("id, block_reason");
  if (error) {
    logger.error("pallets.unblock.failed", {
      userId: ctx.userId,
      id: id.data,
      error,
    });
    return { ok: false, error: "No se pudo desbloquear el pallet." };
  }
  if (data.length === 0) {
    return { ok: false, error: "El pallet no existe o no está bloqueado." };
  }

  await logAudit("pallet.unblocked", ctx.userId, {}, id.data);
  return { ok: true, data: undefined };
}
