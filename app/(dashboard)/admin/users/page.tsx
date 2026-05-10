import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  bootstrapOwnerIfNeeded,
  listUsersAction,
} from "@/features/admin-users/actions/users-actions";
import { UsersTable } from "@/features/admin-users/components/users-table";
import { adminUsersKeys } from "@/features/admin-users/lib/admin-users-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const ctx = await requireUserContext();

  // One-shot: if no owner exists, the first authenticated user becomes one.
  await bootstrapOwnerIfNeeded();
  const refreshed = await requireUserContext();

  if (!userCan(refreshed.roles, "users:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: adminUsersKeys.list(),
      queryFn: () => runAction(() => listUsersAction()),
    },
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Gestioná los miembros del equipo y sus roles.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <UsersTable
            actorRoles={refreshed.roles}
            currentUserId={ctx.userId}
          />
        </Suspense>
      </Hydrate>
    </div>
  );
}
