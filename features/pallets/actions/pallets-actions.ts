"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  PalletBulkCreateSchema,
  PalletBulkDispatchSchema,
  PalletCreateSchema,
  PalletUpdateSchema,
  isPalletStatus,
  type Pallet,
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
  | "created_at"
  | "updated_at"
> & {
  warehouse: { name: string } | null;
  client: { legal_name: string } | null;
  product: { name: string } | null;
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
  "id, warehouse_id, client_id, product_id, code, quantity, status, entry_date, exit_date, notes, created_at, updated_at, warehouse:warehouses(name), client:clients(legal_name), product:products(name)";

export async function listPalletsAction(): Promise<ActionResult<Pallet[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:read")) {
    return { ok: false, error: "No tenés permiso para ver pallets." };
  }
  const supabase = await createSupabaseClient();
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
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya existe un pallet con ese código." };
    }
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
    logger.error("pallets.bulk_create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron crear los pallets." };
  }
  const created = data?.length ?? codes.length;
  await logAudit("pallet.bulk_created", ctx.userId, { count: created });
  return { ok: true, data: { created } };
}

/**
 * Bulk OUT: mark the selected pallets as despachado with an exit date. Only
 * pallets still en_deposito are dispatched (idempotent re-runs are no-ops). The
 * exit date drives storage-billing: it caps the stored days and triggers the
 * descarga (handling_out) charge for the period it falls in.
 */
export async function dispatchPalletsBulkAction(
  input: unknown,
): Promise<ActionResult<{ dispatched: number }>> {
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
    .select("id");
  if (error) {
    logger.error("pallets.bulk_dispatch.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron despachar los pallets." };
  }
  const dispatched = data?.length ?? 0;
  await logAudit("pallet.bulk_dispatched", ctx.userId, { count: dispatched });
  return { ok: true, data: { dispatched } };
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
    })
    .eq("id", id);
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya existe un pallet con ese código." };
    }
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
    logger.error("pallets.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el pallet." };
  }
  await logAudit("pallet.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
