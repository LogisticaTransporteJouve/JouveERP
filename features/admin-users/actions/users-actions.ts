"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { revalidatePath } from "next/cache";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { loadDenies } from "@/lib/auth/denies";
import {
  assignableRoles,
  isRole,
  removableRoles,
  userCan,
  type Role,
} from "@/lib/auth/permissions";
import { listUsersWithRoles, type UserWithRoles } from "@/lib/auth/users";
import {
  PG_CHECK_VIOLATION,
  POSTGREST_FUNCTION_NOT_FOUND,
} from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/observability";
import { getServiceClient } from "@/lib/supabase/service";

import { InviteSchema, SetAccessSchema } from "../schema";

const ADMIN_USERS_PATH = "/admin/users";

export async function listUsersAction(): Promise<
  ActionResult<UserWithRoles[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "users:read")) {
    return { ok: false, error: "No tenés permiso para ver usuarios." };
  }
  const data = await listUsersWithRoles();
  return { ok: true, data };
}

export type UserAccess = { roles: Role[]; denied: string[] };

/** One user's roles and raw denies, for the access dialog. */
export async function getUserAccessAction(
  userId: string,
): Promise<ActionResult<UserAccess>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "users:read")) {
    return { ok: false, error: "No tenés permiso para ver usuarios." };
  }
  const parsed = SetAccessSchema.shape.userId.safeParse(userId);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const service = getServiceClient();
  const [rolesRes, denies] = await Promise.all([
    service.from("user_roles").select("role_id").eq("user_id", parsed.data),
    loadDenies(service, [parsed.data]),
  ]);
  if (rolesRes.error) {
    captureException(rolesRes.error, {
      op: "user.access.load_failed",
      userId: ctx.userId,
      targetUserId: parsed.data,
    });
    return { ok: false, error: "No se pudieron leer los accesos." };
  }
  return {
    ok: true,
    data: {
      roles: (rolesRes.data ?? []).map((r) => r.role_id).filter(isRole),
      denied: denies.get(parsed.data) ?? [],
    },
  };
}

// set_user_access's own errcodes (see its migration), the last-owner trigger,
// and a missing function (code deployed before the migration is approved).
const ACCESS_REJECTIONS: Record<string, string> = {
  UA001: "No podés editar tus propios accesos.",
  UA002: "Otro cambio se guardó antes; recargá los accesos.",
  UA003: "No podés modificar ese rol.",
  [PG_CHECK_VIOLATION]: "Tiene que quedar al menos un usuario con rol owner.",
  [POSTGREST_FUNCTION_NOT_FOUND]:
    "Actualización pendiente; reintentá en unos minutos.",
};

/**
 * Saves a user's roles and per-user denies in one transaction
 * (public.set_user_access). Editing roles needs users:assign_role, editing
 * denies users:manage_access; nobody edits their own access.
 */
export async function setUserAccessAction(raw: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  const parsed = SetAccessSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const input = parsed.data;

  if (input.userId === ctx.userId) {
    return { ok: false, error: "No podés editar tus propios accesos." };
  }
  if (input.roles !== null && !userCan(ctx.access, "users:assign_role")) {
    return { ok: false, error: "No tenés permiso para modificar roles." };
  }
  if (input.denied !== null && !userCan(ctx.access, "users:manage_access")) {
    return { ok: false, error: "No tenés permiso para modificar accesos." };
  }

  const { error } = await getServiceClient().rpc("set_user_access", {
    p_actor: ctx.userId,
    p_user_id: input.userId,
    ...(input.roles ? { p_roles: input.roles } : {}),
    ...(input.denied ? { p_denied: input.denied } : {}),
    p_addable_roles: assignableRoles(ctx.access),
    p_removable_roles: removableRoles(ctx.access),
    p_expected_roles: input.expectedRoles,
    p_expected_denied: input.expectedDenied,
  });
  if (error) {
    const rejection = ACCESS_REJECTIONS[error.code];
    if (rejection) {
      logger.warn("user.access.update.rejected", {
        userId: ctx.userId,
        targetUserId: input.userId,
        code: error.code,
      });
      return { ok: false, error: rejection };
    }
    captureException(error, {
      op: "user.access.update.failed",
      userId: ctx.userId,
      targetUserId: input.userId,
    });
    return { ok: false, error: "No se pudieron guardar los accesos." };
  }

  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, data: undefined };
}

export async function inviteUserAction(
  raw: unknown,
): Promise<ActionResult<{ userId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "users:invite")) {
    return { ok: false, error: "No tenés permiso para invitar usuarios." };
  }

  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const grantable = assignableRoles(ctx.access);
  if (!parsed.data.roles.every((role) => grantable.includes(role))) {
    return { ok: false, error: "No podés asignar alguno de esos roles." };
  }

  const service = getServiceClient();
  const { data, error } = await service.auth.admin.inviteUserByEmail(
    parsed.data.email,
  );
  if (error || !data.user) {
    logger.warn("user.invite.failed", {
      userId: ctx.userId,
      code: error?.code,
    });
    return { ok: false, error: "No se pudo enviar la invitación." };
  }
  const invitedId = data.user.id;

  // Re-inviting a pending user returns the existing account, which may
  // already have roles: those are edited in the access dialog, not here.
  const { data: existing, error: existingError } = await service
    .from("user_roles")
    .select("role_id")
    .eq("user_id", invitedId)
    .limit(1);
  if (existingError) {
    captureException(existingError, {
      op: "user.invite.roles_failed",
      userId: ctx.userId,
      targetUserId: invitedId,
    });
    return { ok: false, error: "Usuario invitado pero no se asignaron roles." };
  }
  if ((existing ?? []).length > 0) {
    return { ok: false, error: "Ya estaba invitado; editá sus accesos." };
  }

  // A brand-new account: one insert and no RPC, so inviting works even before
  // the set_user_access migration is applied.
  const { error: rolesError } = await service.from("user_roles").upsert(
    parsed.data.roles.map((role) => ({
      user_id: invitedId,
      role_id: role,
      granted_by: ctx.userId,
    })),
    { onConflict: "user_id,role_id", ignoreDuplicates: true },
  );
  if (rolesError) {
    captureException(rolesError, {
      op: "user.invite.roles_failed",
      userId: ctx.userId,
      targetUserId: invitedId,
    });
    return { ok: false, error: "Usuario invitado pero no se asignaron roles." };
  }

  await logAudit(
    "user.invited",
    ctx.userId,
    { roles: parsed.data.roles },
    undefined,
    { targetUserId: invitedId },
  );
  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, data: { userId: invitedId } };
}
