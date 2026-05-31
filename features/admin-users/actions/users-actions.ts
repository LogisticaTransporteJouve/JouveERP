"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import {
  ROLES,
  canAssignRole,
  isRole,
  userCan,
  type Role,
} from "@/lib/auth/permissions";
import {
  listUsersWithRoles,
  ownerCount,
  type UserWithRoles,
} from "@/lib/auth/users";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

const RoleEnum = z.enum(ROLES);

const InviteSchema = z.object({
  email: z.string().email(),
  roles: z.array(RoleEnum).min(1),
});

const AssignSchema = z.object({
  userId: z.string().uuid(),
  roleId: RoleEnum,
});

const SetRolesSchema = z.object({
  userId: z.string().uuid(),
  roles: z.array(RoleEnum),
});

const ADMIN_USERS_PATH = "/admin/users";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetUserId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    event_type: eventType,
    target_user_id: targetUserId ?? null,
    payload,
  });
  if (error) {
    logger.error("audit.insert.failed", {
      userId: actorId,
      eventType,
      targetUserId,
      error,
    });
  }
}

export async function listUsersAction(): Promise<
  ActionResult<UserWithRoles[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "users:read")) {
    return { ok: false, error: "No tenés permiso para ver usuarios." };
  }
  const data = await listUsersWithRoles();
  return { ok: true, data };
}

/**
 * Promotes the current user to `owner` if no owner exists yet. One-shot
 * bootstrap so the very first user to log in can self-elevate without
 * needing direct DB access. Idempotent: a no-op once any owner exists.
 */
export async function bootstrapOwnerIfNeeded(): Promise<ActionResult<boolean>> {
  const ctx = await requireUserContext();
  const existingOwners = await ownerCount();
  if (existingOwners > 0) return { ok: true, data: false };

  const service = getServiceClient();
  const { error } = await service
    .from("user_roles")
    .insert({ user_id: ctx.userId, role_id: "owner", granted_by: ctx.userId });
  if (error) {
    logger.error("bootstrap.owner.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo inicializar el owner." };
  }
  await logAudit(
    "user.role.granted",
    ctx.userId,
    { role: "owner", reason: "bootstrap" },
    ctx.userId,
  );
  return { ok: true, data: true };
}

export async function inviteUserAction(
  raw: unknown,
): Promise<ActionResult<{ userId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "users:invite")) {
    return { ok: false, error: "No tenés permiso para invitar usuarios." };
  }

  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const allowedRoles = parsed.data.roles.filter((role) =>
    canAssignRole(ctx.roles, role),
  );
  if (allowedRoles.length === 0) {
    return { ok: false, error: "No podés asignar ninguno de esos roles." };
  }

  const service = getServiceClient();
  const { data, error } = await service.auth.admin.inviteUserByEmail(
    parsed.data.email,
  );
  if (error || !data.user) {
    logger.warn("invite.failed", {
      userId: ctx.userId,
      email: parsed.data.email,
      error,
    });
    return { ok: false, error: "No se pudo enviar la invitación." };
  }

  const inserts = allowedRoles.map((role) => ({
    user_id: data.user!.id,
    role_id: role,
    granted_by: ctx.userId,
  }));
  const { error: rolesError } = await service
    .from("user_roles")
    .insert(inserts);
  if (rolesError) {
    logger.error("invite.roles.failed", {
      userId: ctx.userId,
      targetUserId: data.user.id,
      rolesError,
    });
    return { ok: false, error: "Usuario invitado pero no se asignaron roles." };
  }

  await logAudit(
    "user.invited",
    ctx.userId,
    { email: parsed.data.email, roles: allowedRoles },
    data.user.id,
  );
  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, data: { userId: data.user.id } };
}

export async function assignRoleAction(raw: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "users:assign_role")) {
    return { ok: false, error: "No tenés permiso para asignar roles." };
  }

  const parsed = AssignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  if (!canAssignRole(ctx.roles, parsed.data.roleId)) {
    return {
      ok: false,
      error: `No podés asignar el rol ${parsed.data.roleId}.`,
    };
  }

  const service = getServiceClient();
  const { error } = await service.from("user_roles").upsert(
    {
      user_id: parsed.data.userId,
      role_id: parsed.data.roleId,
      granted_by: ctx.userId,
    },
    { onConflict: "user_id,role_id" },
  );
  if (error) {
    logger.error("role.assign.failed", {
      userId: ctx.userId,
      targetUserId: parsed.data.userId,
      role: parsed.data.roleId,
      error,
    });
    return { ok: false, error: "No se pudo asignar el rol." };
  }

  await logAudit(
    "user.role.granted",
    ctx.userId,
    { role: parsed.data.roleId },
    parsed.data.userId,
  );
  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, data: undefined };
}

export async function revokeRoleAction(raw: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "users:assign_role")) {
    return { ok: false, error: "No tenés permiso para revocar roles." };
  }

  const parsed = AssignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  if (!canAssignRole(ctx.roles, parsed.data.roleId)) {
    return {
      ok: false,
      error: `No podés revocar el rol ${parsed.data.roleId}.`,
    };
  }

  const service = getServiceClient();
  const { error } = await service
    .from("user_roles")
    .delete()
    .match({ user_id: parsed.data.userId, role_id: parsed.data.roleId });
  if (error) {
    // The DB trigger raises check_violation when revoking the last owner —
    // surface a friendly message rather than the SQL detail.
    const message = /owner role/i.test(error.message)
      ? "Tiene que quedar al menos un usuario con rol owner."
      : "No se pudo revocar el rol.";
    logger.warn("role.revoke.failed", {
      userId: ctx.userId,
      targetUserId: parsed.data.userId,
      role: parsed.data.roleId,
      error,
    });
    return { ok: false, error: message };
  }

  await logAudit(
    "user.role.revoked",
    ctx.userId,
    { role: parsed.data.roleId },
    parsed.data.userId,
  );
  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, data: undefined };
}

/**
 * Replaces the role set of a target user with `roles`. Computes the diff
 * against current assignments and emits assign/revoke for each delta. Roles
 * the actor cannot assign are silently kept as-is so the actor cannot
 * accidentally remove privileges they don't control.
 */
export async function setUserRolesAction(raw: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "users:assign_role")) {
    return { ok: false, error: "No tenés permiso para modificar roles." };
  }

  const parsed = SetRolesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const service = getServiceClient();
  const { data: current, error: readError } = await service
    .from("user_roles")
    .select("role_id")
    .eq("user_id", parsed.data.userId);
  if (readError) {
    logger.error("role.read.failed", {
      userId: ctx.userId,
      targetUserId: parsed.data.userId,
      readError,
    });
    return { ok: false, error: "No se pudieron leer los roles actuales." };
  }

  const currentRoles = new Set(
    (current ?? []).map((row) => row.role_id).filter(isRole),
  );
  const desired = new Set<Role>(parsed.data.roles);

  const toAdd: Role[] = [];
  const toRemove: Role[] = [];
  for (const role of desired) {
    if (!currentRoles.has(role)) toAdd.push(role);
  }
  for (const role of currentRoles) {
    if (!desired.has(role)) toRemove.push(role);
  }

  const blockedAdd = toAdd.filter((role) => !canAssignRole(ctx.roles, role));
  const blockedRemove = toRemove.filter(
    (role) => !canAssignRole(ctx.roles, role),
  );
  if (blockedAdd.length > 0 || blockedRemove.length > 0) {
    return {
      ok: false,
      error: `No podés modificar los roles: ${[...blockedAdd, ...blockedRemove].join(", ")}.`,
    };
  }

  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ok: true, data: undefined };
  }

  if (toAdd.length > 0) {
    const { error } = await service.from("user_roles").insert(
      toAdd.map((role) => ({
        user_id: parsed.data.userId,
        role_id: role,
        granted_by: ctx.userId,
      })),
    );
    if (error) {
      logger.error("role.bulk.assign.failed", {
        userId: ctx.userId,
        targetUserId: parsed.data.userId,
        toAdd,
        error,
      });
      return { ok: false, error: "No se pudieron asignar los roles nuevos." };
    }
  }

  for (const role of toRemove) {
    const { error } = await service
      .from("user_roles")
      .delete()
      .match({ user_id: parsed.data.userId, role_id: role });
    if (error) {
      const message = /owner role/i.test(error.message)
        ? "Tiene que quedar al menos un usuario con rol owner."
        : `No se pudo revocar el rol ${role}.`;
      logger.warn("role.bulk.revoke.failed", {
        userId: ctx.userId,
        targetUserId: parsed.data.userId,
        role,
        error,
      });
      return { ok: false, error: message };
    }
  }

  await logAudit(
    "user.roles.updated",
    ctx.userId,
    { added: toAdd, removed: toRemove },
    parsed.data.userId,
  );
  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, data: undefined };
}
