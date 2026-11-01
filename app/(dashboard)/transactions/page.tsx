import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listTransactionsAction } from "@/features/transactions/actions/transactions-actions";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import { TRANSACTIONS_PAGE_SIZE } from "@/features/transactions/lib/pagination";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import {
  parseTransactionListParams,
  transactionListFilters,
} from "@/features/transactions/lib/transaction-list-filters";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readSharedScope } from "@/lib/scope-server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:read")) {
    redirect("/dashboard");
  }

  const params = parseTransactionListParams(await searchParams);
  const filters = transactionListFilters(
    params,
    isFiscalFor(await readSharedScope()),
  );

  // Shared (React cache) with the dashboard layout's channel read.
  const channelsData = await getActiveInvoicingChannels();

  const channels = channelsData.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: transactionsKeys.list(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listTransactionsAction({
            ...filters,
            offset: pageParam,
            limit: TRANSACTIONS_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
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
          <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
          <p className="text-sm text-muted-foreground">
            Ingresos, egresos y transferencias entre cuentas. Cada movimiento se
            imputa a un canal; la lista sigue el alcance elegido arriba.
          </p>
        </div>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <TransactionsTable
            channels={channels}
            actorAccess={ctx.access}
            initialParams={params}
          />
        </Suspense>
      </Hydrate>
    </div>
  );
}
