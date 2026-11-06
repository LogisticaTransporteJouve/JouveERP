"use server";

import type { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  FreightTariffIdSchema,
  FreightTariffIncreaseSchema,
  FreightTariffListCreateSchema,
  FreightTariffListUpdateSchema,
  FreightTariffVersionSaveSchema,
  type FreightTariffIncreaseInput,
  type FreightTariffList,
  type FreightTariffListCreateInput,
  type FreightTariffListUpdateInput,
  type FreightTariffVersionSaveInput,
} from "../schema";

const READ_DENIED = "No tenés permiso para ver las tarifas de flete.";
const WRITE_DENIED = "No tenés permiso para editar las tarifas de flete.";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

const num = (v: number | string | null): number | null =>
  v === null ? null : Number(v);

/** Every tarifario with its versions (newest first) and their lines. A few
 *  dozen lists of a few dozen lines: one read. */
export async function listFreightTariffsAction(): Promise<
  ActionResult<FreightTariffList[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const { data, error } = await getServiceClient()
    .from("freight_tariff_lists")
    .select(
      "id, name, notes, sort_order, client:clients(id, legal_name, display_name), versions:freight_tariff_versions(id, label, valid_from, increase_pct, notes, lines:freight_tariff_lines(id, section, concept, price, percent, note, sort_order))",
    )
    .order("sort_order")
    .order("name");
  if (error) {
    logger.error("freight_tariffs.list.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudieron leer las tarifas de flete." };
  }
  return {
    ok: true,
    data: (data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      notes: l.notes,
      client: l.client
        ? {
            id: l.client.id,
            name: l.client.display_name ?? l.client.legal_name,
          }
        : null,
      versions: [...(l.versions ?? [])]
        .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
        .map((v) => ({
          id: v.id,
          label: v.label,
          valid_from: v.valid_from,
          increase_pct: num(v.increase_pct),
          notes: v.notes,
          lines: [...(v.lines ?? [])]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((line) => ({
              id: line.id,
              section: line.section,
              concept: line.concept,
              price: num(line.price),
              percent: num(line.percent),
              note: line.note,
            })),
        })),
    })),
  };
}

async function replaceLines(
  userId: string,
  versionId: string,
  lines: z.output<typeof FreightTariffVersionSaveSchema>["lines"],
): Promise<string | null> {
  const { error } = await getServiceClient().rpc(
    "replace_freight_tariff_lines",
    { p_version_id: versionId, p_lines: lines },
  );
  if (!error) return null;
  return (
    mapDbGuardError(error, {
      slug: "freight_tariffs.lines.rejected",
      userId,
    }) ?? "No se pudieron guardar los precios."
  );
}

/** A new tarifario with its first period's prices. */
export async function createFreightTariffListAction(
  input: FreightTariffListCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightTariffListCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const supabase = getServiceClient();

  const { data: list, error } = await supabase
    .from("freight_tariff_lists")
    .insert({
      name: d.name,
      client_id: d.client_id ?? null,
      notes: d.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Ya hay un tarifario con ese nombre." };
    }
    logger.error("freight_tariffs.create.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo crear el tarifario." };
  }
  // The list, its version and its lines are three writes: a failure after
  // the first removes the list (its version and lines go with it).
  const undo = async () => {
    await supabase.from("freight_tariff_lists").delete().eq("id", list.id);
  };
  const { data: version, error: versionError } = await supabase
    .from("freight_tariff_versions")
    .insert({
      list_id: list.id,
      label: d.label,
      valid_from: d.valid_from,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (versionError) {
    await undo();
    logger.error("freight_tariffs.create.failed", {
      userId: ctx.userId,
      code: versionError.code,
    });
    return { ok: false, error: "No se pudo crear el tarifario." };
  }
  const linesError = await replaceLines(ctx.userId, version.id, d.lines);
  if (linesError) {
    await undo();
    return { ok: false, error: linesError };
  }

  await logAudit(
    "freight_tariff.list_created",
    ctx.userId,
    { name: d.name, label: d.label, lines: d.lines.length },
    list.id,
  );
  return { ok: true, data: { id: list.id } };
}

export async function updateFreightTariffListAction(
  input: FreightTariffListUpdateInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightTariffListUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const { data, error } = await getServiceClient()
    .from("freight_tariff_lists")
    .update({
      name: d.name,
      client_id: d.client_id ?? null,
      notes: d.notes ?? null,
    })
    .eq("id", d.id)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Ya hay un tarifario con ese nombre." };
    }
    logger.error("freight_tariffs.update.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo actualizar el tarifario." };
  }
  if (data.length === 0)
    return { ok: false, error: "No se encontró el tarifario." };
  await logAudit(
    "freight_tariff.list_updated",
    ctx.userId,
    { name: d.name, client_id: d.client_id ?? null },
    d.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteFreightTariffListAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightTariffIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Tarifario inválido." };
  const { data, error } = await getServiceClient()
    .from("freight_tariff_lists")
    .delete()
    .eq("id", parsed.data.id)
    .select("id, name");
  if (error) {
    logger.error("freight_tariffs.delete.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo borrar el tarifario." };
  }
  const deleted = data[0];
  if (!deleted) return { ok: false, error: "No se encontró el tarifario." };
  await logAudit(
    "freight_tariff.list_deleted",
    ctx.userId,
    { name: deleted.name },
    deleted.id,
  );
  return { ok: true, data: undefined };
}

/** A period's name, start and lines, as edited. */
export async function saveFreightTariffVersionAction(
  input: FreightTariffVersionSaveInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightTariffVersionSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const { data, error } = await getServiceClient()
    .from("freight_tariff_versions")
    .update({ label: d.label, valid_from: d.valid_from })
    .eq("id", d.id)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Ese tarifario ya tiene otro período desde esa fecha.",
      };
    }
    logger.error("freight_tariffs.version_save.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudieron guardar los precios." };
  }
  if (data.length === 0)
    return { ok: false, error: "No se encontró el período." };
  const linesError = await replaceLines(ctx.userId, d.id, d.lines);
  if (linesError) return { ok: false, error: linesError };
  await logAudit(
    "freight_tariff.version_saved",
    ctx.userId,
    { label: d.label, valid_from: d.valid_from, lines: d.lines.length },
    d.id,
  );
  return { ok: true, data: undefined };
}

/** Removes a period (an increase applied by mistake); a tarifario keeps at
 *  least one. */
export async function deleteFreightTariffVersionAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightTariffIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Período inválido." };
  const supabase = getServiceClient();
  const { data: version, error: readError } = await supabase
    .from("freight_tariff_versions")
    .select("id, list_id, label")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (readError) {
    logger.error("freight_tariffs.version_delete.failed", {
      userId: ctx.userId,
      code: readError.code,
    });
    return { ok: false, error: "No se pudo borrar el período." };
  }
  if (!version) return { ok: false, error: "No se encontró el período." };
  const { count, error: countError } = await supabase
    .from("freight_tariff_versions")
    .select("id", { count: "exact", head: true })
    .eq("list_id", version.list_id);
  if (countError) {
    logger.error("freight_tariffs.version_delete.failed", {
      userId: ctx.userId,
      code: countError.code,
    });
    return { ok: false, error: "No se pudo borrar el período." };
  }
  if ((count ?? 0) <= 1) {
    return {
      ok: false,
      error: "Es el único período del tarifario: borrá el tarifario entero.",
    };
  }
  const { error } = await supabase
    .from("freight_tariff_versions")
    .delete()
    .eq("id", version.id);
  if (error) {
    logger.error("freight_tariffs.version_delete.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo borrar el período." };
  }
  await logAudit(
    "freight_tariff.version_deleted",
    ctx.userId,
    { list_id: version.list_id, label: version.label },
    version.id,
  );
  return { ok: true, data: undefined };
}

/** A new period for each chosen tarifario, from its latest prices raised by
 *  a percentage, in one transaction. */
export async function applyFreightTariffIncreaseAction(
  input: FreightTariffIncreaseInput,
): Promise<ActionResult<{ created: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightTariffIncreaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const { data, error } = await getServiceClient().rpc(
    "apply_freight_tariff_increase",
    {
      p_list_ids: d.list_ids,
      p_pct: d.pct,
      p_label: d.label,
      p_valid_from: d.valid_from,
      p_round_to: d.round_to,
      p_user_id: ctx.userId,
    },
  );
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "freight_tariffs.increase.rejected",
      userId: ctx.userId,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("freight_tariffs.increase.failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo aplicar el aumento." };
  }
  const created = Array.isArray(data) ? data.length : 0;
  await logAudit("freight_tariff.increase_applied", ctx.userId, {
    lists: d.list_ids.length,
    pct: d.pct,
    label: d.label,
    valid_from: d.valid_from,
    round_to: d.round_to,
  });
  return { ok: true, data: { created } };
}
