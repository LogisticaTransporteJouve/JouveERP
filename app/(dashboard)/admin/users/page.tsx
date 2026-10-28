import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listUsersAction } from "@/features/admin-users/actions/users-actions";
import { UsersTable } from "@/features/admin-users/components/users-table";
import { adminUsersKeys } from "@/features/admin-users/lib/admin-users-keys";
import { bootstrapOwnerIfNeeded } from "@/features/admin-users/lib/bootstrap-owner";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const ctx = await requireUserContext();

  // One-shot: on a fresh install (no owner yet) the first user ever created
  // becomes owner. requireUserContext() is cached per request, so the page
  // reloads to read the new role.
  if (await bootstrapOwnerIfNeeded(ctx)) {
    redirect("/admin/users");
  }

  if (!userCan(ctx.access, "users:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: adminUsersKeys.list(),
      queryFn: () => runAction(() => listUsersAction()),
    },
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Gestioná los miembros del equipo y sus roles.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <UsersTable actorAccess={ctx.access} currentUserId={ctx.userId} />
        </Suspense>
      </Hydrate>
    </div>
  );
}
