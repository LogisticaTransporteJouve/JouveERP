import { redirect } from "next/navigation";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { getLoanAction } from "@/features/loans/actions/loans-actions";
import { LoanDetail } from "@/features/loans/components/loan-detail";
import { loansKeys } from "@/features/loans/lib/loans-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
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
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, accountsRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: loansKeys.detail(id),
        queryFn: () => runAction(() => getLoanAction(id)),
      },
    ]),
    listAccountsAction(),
  ]);

  const accountOptions = accountsRes.ok
    ? accountsRes.data
        .filter((a) => a.is_active && a.type !== "checks" && a.type !== "echeq")
        .map((a) => ({ id: a.id, name: a.name }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <LoanDetail loanId={id} accountOptions={accountOptions} />
    </Hydrate>
  );
}
