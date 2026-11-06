"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import {
  getStrixAccountStatus,
  type StrixAccountState,
  type StrixSyncRun,
} from "@/lib/strix/strix-account";
import { getServiceClient } from "@/lib/supabase/service";

import { KmRangeInputSchema, StrixCredentialsSchema } from "../schema";

export type StrixStatus = {
  state: StrixAccountState;
  /** Only for who can change it (fleet_km:admin). */
  username: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  sync: StrixSyncRun;
};

/** The Strix user's state and last run, never the password. */
export async function getStrixStatusAction(): Promise<
  ActionResult<StrixStatus>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:read")) {
    return { ok: false, error: "No tenés permiso para ver los km." };
  }
  const status = await getStrixAccountStatus(getServiceClient());
  if (!status) {
    logger.error("strix.account.read_failed", { userId: ctx.userId });
    return { ok: false, error: "No se pudo leer el usuario de Strix." };
  }
  return {
    ok: true,
    data: {
      state: status.state,
      username: userCan(ctx.access, "fleet_km:admin") ? status.username : null,
      lastSuccessAt: status.lastSuccessAt,
      lastErrorCode: status.lastErrorCode,
      sync: status.sync,
    },
  };
}

/** Saves the Strix username and, if typed, a new password. The password goes
 *  straight to Vault and is never logged, audited or returned. */
export async function setStrixCredentialsAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:admin")) {
    return { ok: false, error: "No tenés permiso para configurar Strix." };
  }
  const parsed = StrixCredentialsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const supabase = getServiceClient();
  const before = await getStrixAccountStatus(supabase);
  if (!before) {
    return { ok: false, error: "No se pudo guardar el usuario de Strix." };
  }
  if (before.state === "missing" && parsed.data.password === null) {
    return { ok: false, error: "Falta la clave." };
  }
  if (
    before.state === "rejected" &&
    parsed.data.password === null &&
    before.username === parsed.data.username
  ) {
    return {
      ok: false,
      error:
        "JouveERP dejó de entrar a Strix con esta clave: cargá la clave para volver a intentar.",
    };
  }
  const { error } = await supabase.rpc("set_strix_credentials", {
    p_username: parsed.data.username,
    p_user_id: ctx.userId,
    ...(parsed.data.password !== null && { p_password: parsed.data.password }),
  });
  if (error) {
    logger.error("strix.credentials.save_failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo guardar el usuario de Strix." };
  }
  await logAudit("fleet_km.strix_credentials_saved", ctx.userId, {
    usernameChanged: before.username !== parsed.data.username,
    passwordChanged: parsed.data.password !== null,
  });
  return { ok: true, data: undefined };
}

/** Queues a run that brings the km of the chosen range from Strix. */
export async function requestStrixKmSyncAction(
  input: unknown,
): Promise<ActionResult<{ from: string; to: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:write")) {
    return { ok: false, error: "No tenés permiso para traer km." };
  }
  const parsed = KmRangeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Elegí las fechas.",
    };
  }
  const today = todayInAR();
  const range = {
    from: parsed.data.from,
    to: parsed.data.to > today ? today : parsed.data.to,
  };
  if (range.from > range.to) {
    return { ok: false, error: "No se pueden traer km de días futuros." };
  }

  const service = getServiceClient();
  const status = await getStrixAccountStatus(service);
  if (!status) {
    return { ok: false, error: "No se pudo leer el usuario de Strix." };
  }
  if (status.state === "missing") {
    return {
      ok: false,
      error:
        "Falta cargar el usuario de Strix: lo carga un owner o admin con «Usuario de Strix».",
    };
  }
  if (status.state === "rejected") {
    return {
      ok: false,
      error:
        "JouveERP dejó de entrar a Strix con la clave guardada: un owner o admin tiene que volver a cargarla.",
    };
  }

  // Stamped before the send so the screen follows the run at once; without
  // the stamp it could not, and the request is not sent.
  const { error: stampError } = await service
    .from("strix_account")
    .update({ sync_requested_at: new Date().toISOString() })
    .eq("id", true);
  if (stampError) {
    logger.error("strix_km_sync.stamp_failed", {
      userId: ctx.userId,
      code: stampError.code,
    });
    return {
      ok: false,
      error: "No se pudo pedir a Strix. Probá de nuevo en un rato.",
    };
  }

  const { inngest } = await import("@/lib/inngest/client");
  const { STRIX_KM_SYNC_REQUESTED } = await import("@/lib/inngest/events");
  try {
    await inngest.send({
      name: STRIX_KM_SYNC_REQUESTED,
      data: { requested_by: ctx.userId, ...range },
    });
  } catch (err) {
    logger.error("strix_km_sync.enqueue_failed", {
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: "No se pudo pedir a Strix. Probá de nuevo en un rato.",
    };
  }
  await logAudit("fleet_km.strix_sync_requested", ctx.userId, range);
  return { ok: true, data: range };
}
