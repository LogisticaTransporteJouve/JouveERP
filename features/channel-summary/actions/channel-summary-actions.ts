"use server";

import { requireUserContext } from "@/lib/auth/context";
import { isFiscalOnly, userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { ChannelSummaryInputSchema, type ChannelSummaryMonth } from "../schema";

/** The monthly result of a segregated channel (channel_summary), for its
 *  section's Resumen. Resultado de gestión leaves these channels out. */
export async function getChannelSummaryAction(
  input: unknown,
): Promise<ActionResult<ChannelSummaryMonth[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    return { ok: false, error: "No tenés permiso para ver el resumen." };
  }
  const parsed = ChannelSummaryInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { channelId, from, to } = parsed.data;

  const service = getServiceClient();
  const { data: channel, error: channelError } = await service
    .from("invoicing_channels")
    .select("id, is_fiscal, is_segregated")
    .eq("id", channelId)
    .maybeSingle();
  if (channelError) {
    logger.error("channel_summary.channel_read_failed", {
      userId: ctx.userId,
      error: channelError,
    });
    return { ok: false, error: "No se pudo leer el canal." };
  }
  // Only a segregated channel has a Resumen; a fiscal-only user sees fiscal
  // ones only.
  if (
    !channel ||
    !channel.is_segregated ||
    (isFiscalOnly(ctx.access) && !channel.is_fiscal)
  ) {
    return { ok: false, error: "El canal no tiene resumen." };
  }

  const { data, error } = await service.rpc("channel_summary", {
    p_channel_id: channelId,
    p_from: from,
    p_to: to,
  });
  if (error) {
    logger.error("channel_summary.read_failed", {
      userId: ctx.userId,
      channelId,
      error,
    });
    return { ok: false, error: "No se pudo calcular el resumen." };
  }
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      month: row.month,
      sales: Number(row.sales),
      costs: Number(row.costs),
      margin: Number(row.margin),
      payments: Number(row.payments),
      pendingUsd: Number(row.pending_usd),
    })),
  };
}
