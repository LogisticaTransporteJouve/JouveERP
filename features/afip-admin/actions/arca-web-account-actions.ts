"use server";

import { logAudit } from "@/lib/actions/audit";
import {
  getArcaWebAccountStatus,
  type ArcaWebAccountStatus,
} from "@/lib/afip/arca-web-account";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { ArcaWebCredentialsSchema } from "../schema";

const DENIED = "No tenés permiso para configurar AFIP.";

export async function getArcaWebAccountAction(): Promise<
  ActionResult<ArcaWebAccountStatus>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "afip:admin")) return { ok: false, error: DENIED };
  const status = await getArcaWebAccountStatus(getServiceClient());
  if (!status) {
    logger.error("arca_web.account.read_failed", { userId: ctx.userId });
    return { ok: false, error: "No se pudo leer el usuario de ARCA." };
  }
  return { ok: true, data: status };
}

/** Saves the CUIT and, if typed, a new clave. The clave goes straight to
 *  Vault and is never logged, audited or returned. */
export async function setArcaWebCredentialsAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "afip:admin")) return { ok: false, error: DENIED };
  const parsed = ArcaWebCredentialsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const supabase = getServiceClient();
  const before = await getArcaWebAccountStatus(supabase);
  if (!before) {
    logger.error("arca_web.credentials.save_failed", {
      userId: ctx.userId,
      code: "read",
    });
    return { ok: false, error: "No se pudo guardar el usuario de ARCA." };
  }
  if (before.state === "missing" && parsed.data.password === null) {
    return { ok: false, error: "Falta la clave." };
  }
  // A stopped account starts again only with a new clave (or a new user):
  // saving the same CUIT alone would leave it stopped and look saved.
  if (
    before.state === "rejected" &&
    parsed.data.password === null &&
    before.cuit === parsed.data.cuit
  ) {
    return {
      ok: false,
      error:
        "JouveERP dejó de entrar a ARCA con esta clave: cargá la clave para volver a intentar.",
    };
  }
  const { error } = await supabase.rpc("set_arca_web_credentials", {
    p_cuit: parsed.data.cuit,
    p_user_id: ctx.userId,
    ...(parsed.data.password !== null && { p_password: parsed.data.password }),
  });
  if (error) {
    logger.error("arca_web.credentials.save_failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: "No se pudo guardar el usuario de ARCA." };
  }
  await logAudit("afip.arca_web_credentials_saved", ctx.userId, {
    cuitChanged: before.cuit !== parsed.data.cuit,
    passwordChanged: parsed.data.password !== null,
  });
  return { ok: true, data: undefined };
}
