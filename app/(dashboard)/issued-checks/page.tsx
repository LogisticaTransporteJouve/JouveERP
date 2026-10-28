import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { ExportButton } from "@/components/export-button";
import { listIssuedChecksAction } from "@/features/issued-checks/actions/issued-checks-actions";
import { IssuedChecksTable } from "@/features/issued-checks/components/issued-checks-table";
import { issuedChecksKeys } from "@/features/issued-checks/lib/issued-checks-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function IssuedChecksPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "issued_checks:read")) {
    redirect("/dashboard");
  }

  const accountsResult = await listAccountsAction();
  const accounts = accountsResult.ok ? accountsResult.data : [];

  const dehydratedState = await prefetchQueries([
    {
      queryKey: issuedChecksKeys.list(),
      queryFn: () => runAction(() => listIssuedChecksAction()),
    },
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Cheques propios
          </h1>
          <p className="text-sm text-muted-foreground">
            Cheques emitidos a proveedores. La caja se mueve por la OP — esta
            vista es informativa para seguir qué cheques siguen en circulación.
          </p>
        </div>
        <ExportButton resource="issued-checks" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <IssuedChecksTable accounts={accounts} actorAccess={ctx.access} />
        </Suspense>
      </Hydrate>
    </div>
  );
}
