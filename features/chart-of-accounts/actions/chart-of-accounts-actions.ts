"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  ChartAccountCreateSchema,
  ChartAccountDeleteSchema,
  ChartAccountUpdateSchema,
  levelFromCode,
  parentCodeFromCode,
  type ChartAccount,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };


export async function listChartOfAccountsAction(
  options: { onlyActive?: boolean } = {},
): Promise<ActionResult<ChartAccount[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el plan de cuentas." };
  }

  const supabase = await createClient();
  const query = supabase
    .from("chart_of_accounts")
    .select("*")
    .order("code", { ascending: true });

  if (options.onlyActive) {
    query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) {
    logger.error("chart_of_accounts.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo leer el plan de cuentas." };
  }

  return { ok: true, data: data ?? [] };
}

export async function createChartAccountAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:write")) {
    return { ok: false, error: "No tenés permiso para crear cuentas." };
  }

  const parsed = ChartAccountCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createClient();
  const code = parsed.data.code;
  const expectedLevel = levelFromCode(code);
  const expectedParentCode = parentCodeFromCode(code);

  // Validar coherencia parent_id ↔ code: si el code es raíz (1, 2, …) no
  // debe tener parent_id. Si tiene padre, el code del padre debe ser
  // prefix del code del hijo. Esto evita inconsistencias silenciosas.
  if (expectedParentCode === null) {
    if (parsed.data.parent_id) {
      return {
        ok: false,
        error: "Una cuenta raíz (nivel 1) no puede tener padre.",
      };
    }
  } else {
    if (!parsed.data.parent_id) {
      return {
        ok: false,
        error: "Una cuenta hija debe tener cuenta padre.",
      };
    }
    const { data: parent, error: parentErr } = await supabase
      .from("chart_of_accounts")
      .select("code")
      .eq("id", parsed.data.parent_id)
      .maybeSingle();
    if (parentErr || !parent) {
      return { ok: false, error: "Cuenta padre no encontrada." };
    }
    if (parent.code !== expectedParentCode) {
      return {
        ok: false,
        error: `El código ${code} no es hijo directo de ${parent.code}.`,
      };
    }
  }

  const { data, error } = await supabase
    .from("chart_of_accounts")
    .insert({
      parent_id: parsed.data.parent_id ?? null,
      code,
      name: parsed.data.name,
      level: expectedLevel,
      account_type: parsed.data.account_type,
      eerr_category: parsed.data.eerr_category ?? null,
      system_role: parsed.data.system_role ?? null,
      is_active: parsed.data.is_active,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      if (error.message.includes("system_role")) {
        return {
          ok: false,
          error: "Otra cuenta activa ya tiene ese rol del sistema.",
        };
      }
      return { ok: false, error: "Ya existe una cuenta con ese código." };
    }
    logger.error("chart_of_accounts.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear la cuenta." };
  }

  return { ok: true, data: { id: data.id } };
}

export async function updateChartAccountAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:write")) {
    return { ok: false, error: "No tenés permiso para editar cuentas." };
  }

  const parsed = ChartAccountUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const { id, ...rest } = parsed.data;
  const supabase = await createClient();

  const update = {
    ...(rest.name !== undefined && { name: rest.name }),
    ...(rest.account_type !== undefined && { account_type: rest.account_type }),
    ...(rest.eerr_category !== undefined && { eerr_category: rest.eerr_category }),
    ...(rest.system_role !== undefined && { system_role: rest.system_role }),
    ...(rest.is_active !== undefined && { is_active: rest.is_active }),
  };

  if (Object.keys(update).length === 0) {
    return { ok: true, data: undefined };
  }

  const { error } = await supabase
    .from("chart_of_accounts")
    .update(update)
    .eq("id", id);

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      if (error.message.includes("system_role")) {
        return {
          ok: false,
          error: "Otra cuenta activa ya tiene ese rol del sistema.",
        };
      }
      return { ok: false, error: "Conflicto de unicidad al actualizar." };
    }
    logger.error("chart_of_accounts.update.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo actualizar la cuenta." };
  }

  return { ok: true, data: undefined };
}

export async function deleteChartAccountAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:write")) {
    return { ok: false, error: "No tenés permiso para borrar cuentas." };
  }

  const parsed = ChartAccountDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();

  // Pre-check: si tiene hijos, no se puede borrar (FK restrict). Damos
  // mensaje claro en vez de dejar que la BD devuelva error críptico.
  const { count, error: countErr } = await supabase
    .from("chart_of_accounts")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", parsed.data.id);

  if (countErr) {
    logger.error("chart_of_accounts.delete.precheck_failed", { userId: ctx.userId, error: countErr });
    return { ok: false, error: "No se pudo verificar dependencias." };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `No se puede borrar: tiene ${count} cuenta(s) hija(s). Borralas primero o desactivá la cuenta.`,
    };
  }

  const { error } = await supabase
    .from("chart_of_accounts")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return {
        ok: false,
        error: "La cuenta tiene movimientos asociados, no se puede borrar.",
      };
    }
    logger.error("chart_of_accounts.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la cuenta." };
  }

  return { ok: true, data: undefined };
}
