"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  StorageTariffCreateSchema,
  StorageTariffIncreaseSchema,
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
  | "handling_in"
  | "handling_out"
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
    handling_in: Number(row.handling_in),
    handling_out: Number(row.handling_out),
  };
}

const SELECT_COLUMNS =
  "id, client_id, rate_per_pallet, handling_in, handling_out, period, valid_from, valid_to, is_active, notes, created_at, client:clients(legal_name)";

export async function listStorageTariffsAction(): Promise<
  ActionResult<StorageTariff[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:read")) {
    return {
      ok: false,
      error: "No tenés permiso para ver tarifas de almacenaje.",
    };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("storage_tariffs")
      .select(SELECT_COLUMNS)
      .order("valid_from", { ascending: false })
      .order("id")
      .range(from, to),
  );
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
      handling_in: parsed.data.handling_in,
      handling_out: parsed.data.handling_out,
      period: parsed.data.period,
      valid_from: parsed.data.valid_from,
      valid_to: parsed.data.valid_to ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("storage_tariffs.create.failed", {
      userId: ctx.userId,
      error,
    });
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
      ...(rest.handling_in !== undefined && { handling_in: rest.handling_in }),
      ...(rest.handling_out !== undefined && {
        handling_out: rest.handling_out,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Applies a % increase to every tariff in effect at `valid_from`: inserts the
 * new row (rate + handling × factor, open-ended) and closes the old one the
 * day before. Old rows stay as history; billing runs already snapshot what
 * they used. Tariffs that start on/after `valid_from` are skipped (edit those
 * by hand).
 */
export async function increaseStorageTariffsAction(
  input: unknown,
): Promise<ActionResult<{ updated: number; skipped: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:issue")) {
    return { ok: false, error: "No tenés permiso para editar tarifas." };
  }
  const parsed = StorageTariffIncreaseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { percent, valid_from } = parsed.data;
  const factor = 1 + percent / 100;

  const supabase = await createSupabaseClient();
  const { data: current, error } = await supabase
    .from("storage_tariffs")
    .select(
      "id, client_id, rate_per_pallet, handling_in, handling_out, period, valid_from, valid_to",
    )
    .eq("is_active", true)
    .or(`valid_to.is.null,valid_to.gte.${valid_from}`);
  if (error) {
    logger.error("storage_tariffs.increase.read_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer las tarifas vigentes." };
  }

  const eligible = (current ?? []).filter((t) => t.valid_from < valid_from);
  const skipped = (current ?? []).length - eligible.length;
  if (eligible.length === 0) {
    return {
      ok: false,
      error: "No hay tarifas vigentes anteriores a esa fecha para aumentar.",
    };
  }

  // One bulk insert for all the new rows (atomic: all or none), then one
  // chunked update closing the old ones the day before. Was 2 round trips per
  // tariff. Inserting first keeps the previous invariant: if the close fails
  // the new row still wins (latest valid_from) and the overlap is logged.
  const { data: inserted, error: insErr } = await supabase
    .from("storage_tariffs")
    .insert(
      eligible.map((t) => {
        const oldRate = Number(t.rate_per_pallet);
        return {
          client_id: t.client_id,
          rate_per_pallet: round2(oldRate * factor),
          handling_in: round2(Number(t.handling_in) * factor),
          handling_out: round2(Number(t.handling_out) * factor),
          period: t.period,
          valid_from,
          valid_to: null,
          notes: `Aumento ${percent}% s/ $${oldRate.toLocaleString("es-AR")}`,
          created_by: ctx.userId,
        };
      }),
    )
    .select("id");
  if (insErr || !inserted) {
    logger.error("storage_tariffs.increase.insert_failed", {
      userId: ctx.userId,
      count: eligible.length,
      error: insErr,
    });
    return { ok: false, error: "No se pudo aplicar el aumento." };
  }
  const updated = inserted.length;

  const closeRes = await fetchInChunks(
    eligible.map((t) => t.id),
    (ids) =>
      supabase
        .from("storage_tariffs")
        .update({ valid_to: dayBefore(valid_from) })
        .in("id", ids)
        .select("id"),
  );
  if (closeRes.error) {
    // The new rows still win (latest valid_from), but log the overlap.
    logger.error("storage_tariffs.increase.close_failed", {
      userId: ctx.userId,
      tariffIds: eligible.map((t) => t.id),
      error: closeRes.error,
    });
  }

  if (updated === 0) {
    return { ok: false, error: "No se pudo aplicar el aumento." };
  }

  await logAudit("storage_tariff.increased", ctx.userId, {
    percent,
    valid_from,
    updated,
    skipped,
  });
  return { ok: true, data: { updated, skipped } };
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
    logger.error("storage_tariffs.delete.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo borrar la tarifa." };
  }
  await logAudit("storage_tariff.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
