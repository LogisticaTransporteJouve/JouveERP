import { redirect } from "next/navigation";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listCardStatementsAction } from "@/features/card-statements/actions/card-statements-actions";
import { CardStatementsView } from "@/features/card-statements/components/card-statements-view";
import { cardStatementsKeys } from "@/features/card-statements/lib/card-statements-keys";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  TREASURY_WRITE_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function CardStatementsRoute() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: cardStatementsKeys.list(),
      queryFn: () => runAction(() => listCardStatementsAction()),
    },
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <CardStatementsView
        canWrite={userCanAll(ctx.access, TREASURY_WRITE_PERMISSIONS)}
        canAdvance={
          userCanAll(ctx.access, TREASURY_WRITE_PERMISSIONS) &&
          userCan(ctx.access, "hr:write")
        }
      />
    </Hydrate>
  );
}
