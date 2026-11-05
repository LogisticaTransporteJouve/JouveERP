import { redirect } from "next/navigation";

import { listLoansAction } from "@/features/loans/actions/loans-actions";
import { LoansTable } from "@/features/loans/components/loans-table";
import { loansKeys } from "@/features/loans/lib/loans-keys";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readSharedScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

export default async function LoansRoute() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    redirect("/dashboard");
  }

  const isFiscal = isFiscalFor(await readSharedScope());
  // «Nuevo préstamo» picks its channel from the layout's scope, which says a
  // failed read under the select.
  const dehydratedState = await prefetchQueries([
    {
      queryKey: loansKeys.list(isFiscal),
      queryFn: () => runAction(() => listLoansAction({ isFiscal })),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <LoansTable canWrite={userCan(ctx.access, "accounting:write")} />
    </Hydrate>
  );
}
