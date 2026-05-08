import { redirect } from "next/navigation";

import { UsersTable } from "@/features/admin-users/components/users-table";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { listUsersWithRoles } from "@/lib/auth/users";
import {
  bootstrapOwnerIfNeeded,
} from "@/features/admin-users/actions/users-actions";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const ctx = await requireUserContext();

  // One-shot: if no owner exists, the first authenticated user becomes one.
  // After this returns the user may have gained the `owner` role; refresh ctx.
  await bootstrapOwnerIfNeeded();
  const refreshed = await requireUserContext();

  if (!userCan(refreshed.roles, "users:read")) {
    redirect("/dashboard");
  }

  const users = await listUsersWithRoles();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Gestioná los miembros del equipo y sus roles.
        </p>
      </div>
      <UsersTable
        users={users}
        actorRoles={refreshed.roles}
        currentUserId={ctx.userId}
      />
    </div>
  );
}
