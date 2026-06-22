"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  StorageTariffCreateSchema,
  StorageTariffToggleSchema,
  StorageTariffUpdateSchema,
  isTariffPeriod,
  type StorageTariff,
} from "../schema";

type StorageTariffSelectRow = Pick<
  Database["public"]["Tables"]["storage_tariffs"]["Row"],
  | "id"
  | "client_id"
  | "rate_per_pallet"
  | "period"
  | "valid_from"
  | "valid_to"
  | "is_active"
  | "notes"
  | "created_at"
> & { client: { legal_name: string } | null };

function narrow(row: StorageTariffSelectRow): StorageTariff | null {
  if (!isTariffPeriod(row.period)) {
    logger.error("storage_tariffs.unknown_period", { period: row.period });
    return null;
  }
  return {
    ...row,
    period: row.period,
    rate_per_pallet: Number(row.rate_per_pallet),
  };
}

const SELECT_COLUMNS =
  "id, client_id, rate_per_pallet, period, valid_from, valid_to, is_active, notes, created_at, client:clients(legal_name)";

export async function listStorageTariffsAction(): Promise<
  ActionResult<StorageTariff[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:read")) {
    return { ok: false, error: "No tenés permiso para ver tarifas de almacenaje." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("storage_tariffs")
    .select(SELECT_COLUMNS)
    .order("valid_from", { ascending: false });
  if (error) {
    logger.error("storage_tariffs.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las tarifas." };
  }

  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is StorageTariff => row !== null);
  return { ok: true, data: rows };
}

export async function createStorageTariffAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para crear tarifas." };
  }
  const parsed = StorageTariffCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("storage_tariffs")
    .insert({
      client_id: parsed.data.client_id ?? null,
      rate_per_pallet: parsed.data.rate_per_pallet,
      period: parsed.data.period,
      valid_from: parsed.data.valid_from,
      valid_to: parsed.data.valid_to ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("storage_tariffs.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear la tarifa." };
  }

  await logAudit(
    "storage_tariff.created",
    ctx.userId,
    {
      client_id: parsed.data.client_id ?? null,
      rate_per_pallet: parsed.data.rate_per_pallet,
      period: parsed.data.period,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateStorageTariffAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para editar tarifas." };
  }
  const parsed = StorageTariffUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("storage_tariffs")
    .update({
      ...(rest.client_id !== undefined && { client_id: rest.client_id }),
      ...(rest.rate_per_pallet !== undefined && {
        rate_per_pallet: rest.rate_per_pallet,
      }),
      ...(rest.period !== undefined && { period: rest.period }),
      ...(rest.valid_from !== undefined && { valid_from: rest.valid_from }),
      ...(rest.valid_to !== undefined && { valid_to: rest.valid_to }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("storage_tariffs.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la tarifa." };
  }

  await logAudit(
    "storage_tariff.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function setStorageTariffActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para editar tarifas." };
  }
  const parsed = StorageTariffToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("storage_tariffs")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("storage_tariffs.toggle.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  await logAudit(
    parsed.data.is_active
      ? "storage_tariff.reactivated"
      : "storage_tariff.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteStorageTariffAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para borrar tarifas." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("storage_tariffs")
    .delete()
    .eq("id", input.id);
  if (error) {
    logger.error("storage_tariffs.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la tarifa." };
  }
  await logAudit("storage_tariff.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
