"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import {
  getArcaWebAccountStatus,
  type ArcaWebAccountState,
} from "@/lib/afip/arca-web-account";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { syncPeriodFromMonths } from "../lib/arca-sync-period";

const DENIED = "No tenés permiso para cargar compras.";

export type ArcaSyncStatus = {
  state: ArcaWebAccountState;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
};

/** Whether «Traer de ARCA» can run: the stored user's state, never the clave
 *  or the CUIT. */
export async function getArcaSyncStatusAction(): Promise<
  ActionResult<ArcaSyncStatus>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const status = await getArcaWebAccountStatus(getServiceClient());
  if (!status) {
    return { ok: false, error: "No se pudo leer el usuario de ARCA." };
  }
  return {
    ok: true,
    data: {
      state: status.state,
      lastSuccessAt: status.lastSuccessAt,
      lastErrorCode: status.lastErrorCode,
    },
  };
}

const RequestSchema = z.object({
  fromMonth: z.string(),
  toMonth: z.string(),
});

function todayInArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

/** Queues a run that brings Recibidos of the chosen months into the tray. */
export async function requestArcaReceivedSyncAction(
  input: unknown,
): Promise<ActionResult<{ from: string; to: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Elegí el mes desde y el mes hasta." };
  }
  const period = syncPeriodFromMonths(
    parsed.data.fromMonth,
    parsed.data.toMonth,
    todayInArgentina(),
  );
  if (typeof period === "string") return { ok: false, error: period };

  const status = await getArcaWebAccountStatus(getServiceClient());
  if (!status) {
    return { ok: false, error: "No se pudo leer el usuario de ARCA." };
  }
  if (status.state === "missing") {
    return {
      ok: false,
      error:
        "Falta cargar el usuario de ARCA: lo carga un owner o admin en Admin → AFIP → Puntos de venta.",
    };
  }
  if (status.state === "rejected") {
    return {
      ok: false,
      error:
        "ARCA rechazó la clave guardada: un owner o admin tiene que actualizarla en Admin → AFIP → Puntos de venta.",
    };
  }

  const { inngest } = await import("@/lib/inngest/client");
  const { ARCA_RECEIVED_SYNC_REQUESTED } = await import("@/lib/inngest/events");
  try {
    await inngest.send({
      name: ARCA_RECEIVED_SYNC_REQUESTED,
      data: { requested_by: ctx.userId, ...period },
    });
  } catch (err) {
    logger.error("arca_received_sync.enqueue_failed", {
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: "No se pudo pedir a ARCA. Probá de nuevo en un rato.",
    };
  }
  await logAudit("purchase_invoice.arca_sync_requested", ctx.userId, period);
  return { ok: true, data: period };
}
