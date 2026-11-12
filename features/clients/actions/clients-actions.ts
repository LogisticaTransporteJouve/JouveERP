"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  CLIENT_NOT_FOUND,
  createClientRecord,
  updateClientRecord,
} from "@/lib/commands/save-client";
import { PG_FOREIGN_KEY_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  ClientCreateSchema,
  ClientToggleActiveSchema,
  ClientUpdateSchema,
  isIvaCondition,
  type Client,
  type PartyPickerAccess,
} from "../schema";

function narrowClient(row: {
  iva_condition: string | null;
  [key: string]: unknown;
}): Client | null {
  if (row.iva_condition !== null && !isIvaCondition(row.iva_condition)) {
    logger.error("clients.unknown_iva_condition", {
      value: row.iva_condition,
    });
    return null;
  }
  return row as Client;
}

export async function listClientsAction(): Promise<ActionResult<Client[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  const supabase = await createSupabaseClient();
  // Paged: PostgREST cuts a single read at 1000 rows without an error.
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("clients")
      .select(
        "id, cuit, legal_name, display_name, iva_condition, is_fiscal, email, phone, address, real_address, notes, is_active, created_by, created_at, updated_at",
      )
      .order("legal_name")
      .order("id")
      .range(from, to),
  );

  if (error) {
    logger.error("clients.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo listar los clientes." };
  }

  const clients = (data ?? [])
    .map((row) => narrowClient(row))
    .filter((row): row is Client => row !== null);

  return { ok: true, data: clients };
}

export type SearchClientsInput = {
  query?: string;
  onlyActive?: boolean;
  /** Ventas (true) or Otras ventas (false); null lists both. */
  isFiscal?: boolean | null;
  /** A segregated channel's section: clients that only live on it are
   *  listed too (clients are one shared list). Without it they are left out. */
  channelId?: string | null;
  offset?: number;
  limit?: number;
};

export type SearchClientsPage = {
  clients: Client[];
  nextOffset: number | null;
};

export async function getClientPickerAccessAction(): Promise<
  ActionResult<PartyPickerAccess>
> {
  const ctx = await requireUserContext();
  const canRead = userCan(ctx.access, "clients:read");
  return {
    ok: true,
    data: {
      canRead,
      canCreate: canRead && userCan(ctx.access, "clients:write"),
    },
  };
}

export async function searchClientsAction(
  input: SearchClientsInput = {},
): Promise<ActionResult<SearchClientsPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  const supabase = await createSupabaseClient();
  // Fetch limit+1 to detect whether another page exists without a separate
  // count round-trip.
  const { data, error } = await supabase.rpc("search_clients", {
    p_query: (input.query ?? "").trim(),
    p_only_active: input.onlyActive ?? true,
    p_offset: offset,
    p_limit: limit + 1,
    p_is_fiscal: input.isFiscal ?? undefined,
    p_channel_id: input.channelId ?? undefined,
  });

  if (error) {
    logger.error("clients.search.failed", {
      userId: ctx.userId,
      query: input.query,
      error,
    });
    return { ok: false, error: "No se pudo buscar clientes." };
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const clients = rows
    .slice(0, limit)
    .map((row) => narrowClient(row))
    .filter((row): row is Client => row !== null);

  return {
    ok: true,
    data: { clients, nextOffset: hasMore ? offset + limit : null },
  };
}

export async function getClientByIdAction(
  id: string,
): Promise<ActionResult<Client | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, cuit, legal_name, display_name, iva_condition, is_fiscal, email, phone, address, real_address, notes, is_active, created_by, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("clients.get.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo cargar el cliente." };
  }

  return { ok: true, data: data ? narrowClient(data) : null };
}

export async function findClientByCuitAction(
  cuit: string,
): Promise<ActionResult<Client | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  const cuitClean = cuit.replace(/[^0-9]/g, "");
  if (!/^[0-9]{11}$/.test(cuitClean)) {
    return { ok: true, data: null };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, cuit, legal_name, display_name, iva_condition, is_fiscal, email, phone, address, real_address, notes, is_active, created_by, created_at, updated_at",
    )
    .eq("cuit", cuitClean)
    .maybeSingle();

  if (error) {
    logger.error("clients.find_by_cuit.failed", {
      userId: ctx.userId,
      cuit: cuitClean,
      error,
    });
    return { ok: false, error: "No se pudo buscar el cliente por CUIT." };
  }

  return { ok: true, data: data ? narrowClient(data) : null };
}

export async function createClientAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:write")) {
    return { ok: false, error: "No tenés permiso para crear clientes." };
  }

  const parsed = ClientCreateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  return createClientRecord(ctx.userId, parsed.data);
}

export async function updateClientAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:write")) {
    return { ok: false, error: "No tenés permiso para editar clientes." };
  }

  const parsed = ClientUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const res = await updateClientRecord(ctx.userId, parsed.data);
  return res.ok ? { ok: true, data: undefined } : res;
}

export type ClientReferences = {
  total: number;
  details: Record<string, number>;
};

/**
 * Counts referencing rows across known dependent tables. Until invoices,
 * receipts, etc land in later phases, the count is always zero — but the
 * DeactivateClientDialog already routes through this so adding new tables only
 * means extending the map below.
 */
export async function getClientReferencesAction(
  id: string,
): Promise<ActionResult<ClientReferences>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  // Each entry: { table, column } where column is the FK to clients.id.
  // Every table that references clients. RESTRICT rows block the delete anyway
  // (surface a clear message); CASCADE rows (opening balances, allocations,
  // storage and client tariffs, attachments) would be silently wiped, so
  // count them here.
  const dependents: Array<{ table: string; column: string }> = [
    { table: "invoices", column: "client_id" },
    { table: "receipts", column: "client_id" },
    { table: "checks", column: "source_client_id" },
    { table: "pallets", column: "client_id" },
    { table: "products", column: "client_id" },
    { table: "shipments", column: "client_id" },
    { table: "storage_billing_runs", column: "client_id" },
    { table: "storage_tariffs", column: "client_id" },
    { table: "client_tariffs", column: "client_id" },
    { table: "late_interest_charges", column: "client_id" },
    { table: "client_opening_balances", column: "client_id" },
    { table: "client_opening_balance_allocations", column: "client_id" },
    { table: "file_attachments", column: "client_id" },
    { table: "transactions", column: "counterparty_client_id" },
  ];

  const supabase = await createSupabaseClient();
  const details: Record<string, number> = {};
  let total = 0;

  // Independent head-only counts → in parallel (was one round trip per table).
  const counts = await Promise.all(
    dependents.map((dep) =>
      supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(dep.table as any)
        .select("*", { count: "exact", head: true })
        .eq(dep.column, id),
    ),
  );
  // A failed count is not a zero: the delete must not go ahead on it.
  const failed = dependents.filter((_, i) => counts[i]!.error);
  if (failed.length > 0) {
    logger.error("clients.refs.count_failed", {
      userId: ctx.userId,
      id,
      tables: failed.map((dep) => dep.table),
    });
    return {
      ok: false,
      error: "No se pudo verificar si el cliente tiene movimientos asociados.",
    };
  }
  dependents.forEach((dep, i) => {
    const { count } = counts[i]!;
    if (count && count > 0) {
      details[dep.table] = count;
      total += count;
    }
  });

  return { ok: true, data: { total, details } };
}

export async function deleteClientAction(id: string): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:write")) {
    return { ok: false, error: "No tenés permiso para eliminar clientes." };
  }

  const refs = await getClientReferencesAction(id);
  if (!refs.ok) return refs;
  if (refs.data.total > 0) {
    return {
      ok: false,
      error:
        "El cliente tiene movimientos asociados. Desactivalo en lugar de eliminarlo.",
    };
  }

  // RLS deliberately blocks DELETE on clients (see migration C.1). Use the
  // service-role client now that we've validated permissions and refs.
  const service = getServiceClient();
  const { data: changed, error } = await service
    .from("clients")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return {
        ok: false,
        error:
          "El cliente tiene movimientos asociados. Desactivalo en lugar de eliminarlo.",
      };
    }
    logger.error("clients.delete.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo eliminar el cliente." };
  }
  if ((changed ?? []).length === 0) {
    return { ok: false, error: CLIENT_NOT_FOUND };
  }

  await logAudit("client.deleted", ctx.userId, {}, id);
  return { ok: true, data: undefined };
}

export async function setClientActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:write")) {
    return { ok: false, error: "No tenés permiso para editar clientes." };
  }

  const parsed = ClientToggleActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data: changed, error } = await supabase
    .from("clients")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    logger.error("clients.toggle_active.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      is_active: parsed.data.is_active,
      error,
    });
    return { ok: false, error: "No se pudo cambiar el estado del cliente." };
  }
  if ((changed ?? []).length === 0) {
    return { ok: false, error: CLIENT_NOT_FOUND };
  }

  await logAudit(
    parsed.data.is_active ? "client.reactivated" : "client.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}
