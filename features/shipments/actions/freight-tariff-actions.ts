"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";
import { IsoDateSchema } from "@/lib/validation/common";

const FreightTariffLookupSchema = z.object({
  client_id: z.string().uuid(),
  date: IsoDateSchema,
});

/** The client's flete tariff in force on a day (client_tariffs, concept
 *  freight, per carga). */
export type ClientFreightTariff = {
  price: number;
  valid_from: string;
};

/**
 * The flete a new carga of this client takes by default: its flete tariff
 * in force that day, in pesos (the carga's flete is in pesos; a USD tariff
 * is not suggested). Null without one. Read with the service client after
 * the gate: whoever loads cargas suggests the price but does not read the
 * tarifario (storage_billing:read).
 */
export async function getClientFreightTariffAction(input: {
  client_id: string;
  date: string;
}): Promise<ActionResult<ClientFreightTariff | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:write")) {
    return { ok: false, error: "No tenés permiso para cargar cargas." };
  }
  const parsed = FreightTariffLookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const { data, error } = await getServiceClient()
    .rpc("client_tariff_at", {
      p_client_id: parsed.data.client_id,
      p_concept: "freight",
      p_date: parsed.data.date,
    })
    .select("price, currency, valid_from")
    .maybeSingle();
  if (error) {
    logger.error("shipments.freight_tariff.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo leer la tarifa de flete." };
  }
  if (!data || data.currency !== "ARS") return { ok: true, data: null };
  return {
    ok: true,
    data: { price: Number(data.price), valid_from: data.valid_from },
  };
}
