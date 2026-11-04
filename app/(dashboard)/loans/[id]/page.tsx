import { redirect } from "next/navigation";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { getLoanAction } from "@/features/loans/actions/loans-actions";
import { LoanDetail } from "@/features/loans/components/loan-detail";
import { LOAN_CASH_PERMISSIONS } from "@/features/loans/lib/loan-cash";
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

export const dynamic = "force-dynamic";

export default async function LoanDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    redirect("/dashboard");
  }

  // The accounts feed «Pagar» and «Registrar desembolso»; a failed read is
  // shown (with «Reintentar») by the detail, not turned into no options.
  const dehydratedState = await prefetchQueries([
    {
      queryKey: loansKeys.detail(id),
      queryFn: () => runAction(() => getLoanAction(id)),
    },
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <LoanDetail
        loanId={id}
        canWrite={userCan(ctx.access, "accounting:write")}
        canMoveCash={userCanAll(ctx.access, LOAN_CASH_PERMISSIONS)}
      />
    </Hydrate>
  );
}
