"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import type { LibroIvaComprasRow, LibroIvaVentasRow } from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function listLibroIvaVentasAction(input: {
  period: string;
  channelId?: string | null;
}): Promise<ActionResult<LibroIvaVentasRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro IVA." };
  }
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    return { ok: false, error: "Período inválido (formato YYYY-MM)." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("libro_iva_ventas", {
    p_period: input.period,
    p_channel_id: input.channelId ?? undefined,
  });

  if (error) {
    logger.error("libro_iva_ventas.failed", { error });
    return { ok: false, error: "No se pudo leer el libro IVA Ventas." };
  }

  return { ok: true, data: (data ?? []) as LibroIvaVentasRow[] };
}

export async function listLibroIvaComprasAction(input: {
  period: string;
  channelId?: string | null;
}): Promise<ActionResult<LibroIvaComprasRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro IVA." };
  }
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    return { ok: false, error: "Período inválido (formato YYYY-MM)." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("libro_iva_compras", {
    p_period: input.period,
    p_channel_id: input.channelId ?? undefined,
  });

  if (error) {
    logger.error("libro_iva_compras.failed", { error });
    return { ok: false, error: "No se pudo leer el libro IVA Compras." };
  }

  return { ok: true, data: (data ?? []) as LibroIvaComprasRow[] };
}
