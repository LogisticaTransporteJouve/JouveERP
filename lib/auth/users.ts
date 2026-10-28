import "server-only";

import { loadDenies } from "@/lib/auth/denies";
import {
  isRole,
  permissionResource,
  resolveAccess,
  roleGrants,
  ROLES,
  userCan,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";
import { getServiceClient } from "@/lib/supabase/service";

export type UserWithRoles = {
  id: string;
  email: string;
  lastSignInAt: string | null;
  createdAt: string;
  roles: Role[];
};

/**
 * Lists all users with their roles. Uses the service client to read the auth
 * schema and the role assignments. Callers must enforce `users:read`
 * themselves — this helper does no authorization on its own.
 */
export async function listUsersWithRoles(): Promise<UserWithRoles[]> {
  const service = getServiceClient();

  const { data: usersResponse, error: usersError } =
    await service.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) throw usersError;

  const userIds = usersResponse.users.map((user) => user.id);
  if (userIds.length === 0) return [];

  const { data: assignments, error: rolesError } = await service
    .from("user_roles")
    .select("user_id, role_id")
    .in("user_id", userIds);
  if (rolesError) throw rolesError;

  const rolesByUser = new Map<string, Role[]>();
  for (const row of assignments ?? []) {
    if (!isRole(row.role_id)) continue;
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.role_id);
    rolesByUser.set(row.user_id, list);
  }

  return usersResponse.users.map((user) => ({
    id: user.id,
    email: user.email ?? "",
    lastSignInAt: user.last_sign_in_at ?? null,
    createdAt: user.created_at,
    roles: rolesByUser.get(user.id) ?? [],
  }));
}

/**
 * The users whose effective access includes `permission`, for notifications a
 * job fans out. Candidates come from the roles that grant it; each one's
 * denies of that permission or of its resource's `:read` then drop them.
 */
export async function listUserIdsWithPermission(
  permission: Permission,
): Promise<string[]> {
  const service = getServiceClient();
  const holderRoles = ROLES.filter((role) => roleGrants(role, permission));
  const { data, error } = await service
    .from("user_roles")
    .select("user_id, role_id")
    .in("role_id", holderRoles);
  if (error) throw error;

  const rolesByUser = new Map<string, Role[]>();
  for (const row of data ?? []) {
    if (!isRole(row.role_id)) continue;
    rolesByUser.set(row.user_id, [
      ...(rolesByUser.get(row.user_id) ?? []),
      row.role_id,
    ]);
  }
  const userIds = [...rolesByUser.keys()];
  const denies = await loadDenies(service, userIds, [
    ...new Set([permission, `${permissionResource(permission)}:read`]),
  ]);
  return userIds.filter((id) =>
    userCan(
      resolveAccess(rolesByUser.get(id) ?? [], denies.get(id) ?? []),
      permission,
    ),
  );
}
