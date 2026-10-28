import { redirect } from "next/navigation";

import { listUsersAction } from "@/features/admin-users/actions/users-actions";
import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { DriversTable } from "@/features/drivers/components/drivers-table";
import type { LinkableUser } from "@/features/drivers/components/driver-link-dialog";
import { driversKeys } from "@/features/drivers/lib/drivers-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function DriversPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "drivers:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: driversKeys.list(false),
      queryFn: () => runAction(() => listDriversAction({ onlyActive: false })),
    },
  ]);

  // The driver→login link is an admin action; only fetch the user list (and
  // expose the link UI) when the caller can assign roles.
  let linkableUsers: LinkableUser[] | undefined;
  if (userCan(ctx.access, "users:assign_role")) {
    const res = await listUsersAction();
    if (res.ok) {
      linkableUsers = res.data.map((u) => ({ id: u.id, email: u.email }));
    }
  }

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <DriversTable linkableUsers={linkableUsers} />
      </div>
    </Hydrate>
  );
}
