"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { PeriodSchema } from "@/lib/validation/common";

import type { LibroIvaComprasRow, LibroIvaVentasRow } from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const LibroIvaInput = z.object({
  period: PeriodSchema,
  channelId: z.string().nullable().optional(),
});

export async function listLibroIvaVentasAction(input: {
  period: string;
  channelId?: string | null;
}): Promise<ActionResult<LibroIvaVentasRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro IVA." };
  }
  const parsed = LibroIvaInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  input = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("libro_iva_ventas", {
    p_period: input.period,
    p_channel_id: input.channelId ?? undefined,
  });

  if (error) {
    logger.error("libro_iva_ventas.failed", {
      userId: ctx.userId,
      period: input.period,
      error,
    });
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
  const parsed = LibroIvaInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  input = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("libro_iva_compras", {
    p_period: input.period,
    p_channel_id: input.channelId ?? undefined,
  });

  if (error) {
    logger.error("libro_iva_compras.failed", {
      userId: ctx.userId,
      period: input.period,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro IVA Compras." };
  }

  return { ok: true, data: (data ?? []) as LibroIvaComprasRow[] };
}
