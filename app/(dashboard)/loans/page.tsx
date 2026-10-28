import { redirect } from "next/navigation";

import { listInvoicingChannelsAction } from "@/features/invoices/actions/invoices-actions";
import { listLoansAction } from "@/features/loans/actions/loans-actions";
import { LoansTable } from "@/features/loans/components/loans-table";
import { loansKeys } from "@/features/loans/lib/loans-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function LoansRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, channelsRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: loansKeys.list(),
        queryFn: () => runAction(() => listLoansAction()),
      },
    ]),
    listInvoicingChannelsAction(),
  ]);

  const channelOptions = channelsRes.ok ? channelsRes.data : [];

  return (
    <Hydrate state={dehydratedState}>
      <LoansTable channelOptions={channelOptions} />
    </Hydrate>
  );
}
