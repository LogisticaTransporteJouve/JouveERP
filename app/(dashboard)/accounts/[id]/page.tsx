import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { ACCOUNT_TYPE_LABEL, isCheckAccount } from "@/features/accounts/schema";
import { AccountStatement } from "@/features/bank-reconciliation/components/reconciliation-page";
import { reconciliationGates } from "@/features/bank-reconciliation/lib/gates";
import { getReconciliationAction } from "@/features/bank-reconciliation/actions/reconciliation-actions";
import {
  monthParam,
  monthRange,
} from "@/features/bank-reconciliation/lib/month";
import { reconciliationKeys } from "@/features/bank-reconciliation/lib/reconciliation-keys";
import { listTransactionsAction } from "@/features/transactions/actions/transactions-actions";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import { TRANSACTIONS_PAGE_SIZE } from "@/features/transactions/lib/pagination";
import {
  parseTransactionListParams,
  transactionListFilters,
} from "@/features/transactions/lib/transaction-list-filters";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readSharedScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

/** One treasury account: its movements and, for a bank-like account, its
 *  statement (upload and reconciliation). */
export default async function CuentaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounts:read")) {
    redirect("/dashboard");
  }
  const { id } = await params;
  const search = await searchParams;

  const accounts = await runAction(() => listAccountsAction());
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();

  const canReadMovements = userCan(ctx.access, "transactions:read");
  const hasStatement = canReadMovements && !isCheckAccount(account.type);
  const today = todayInAR();
  const month = monthParam(search.month);
  const { from, to } = monthRange(month ?? today.slice(0, 7));

  const listParams = parseTransactionListParams({ ...search, account: id });
  const filters = transactionListFilters(
    listParams,
    isFiscalFor(await readSharedScope()),
  );
  const channels = (await getActiveInvoicingChannels()).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const dehydratedState = await prefetchQueries([
    {
      queryKey: accountsKeys.list(),
      queryFn: () => Promise.resolve(accounts),
    },
    ...(hasStatement
      ? [
          {
            queryKey: reconciliationKeys.view(account.id, from, to),
            queryFn: () =>
              runAction(() =>
                getReconciliationAction({ account_id: account.id, from, to }),
              ),
          },
        ]
      : []),
    ...(canReadMovements
      ? [
          {
            infinite: true as const,
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
        ]
      : []),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {account.name}
        </h1>
        <p className="text-muted-foreground text-sm">
          {ACCOUNT_TYPE_LABEL[account.type]} · {account.currency}
          {!account.is_active && " · Inactiva"}
        </p>
      </div>
      {canReadMovements ? (
        <Hydrate state={dehydratedState}>
          <Tabs defaultValue="movements">
            <TabsList>
              <TabsTrigger value="movements">Movimientos</TabsTrigger>
              {hasStatement && (
                <TabsTrigger value="statement">Extracto</TabsTrigger>
              )}
            </TabsList>
            {hasStatement && (
              <TabsContent value="statement" className="pt-4">
                <AccountStatement
                  accountId={account.id}
                  today={today}
                  initialMonth={month}
                  gates={reconciliationGates(ctx.access)}
                />
              </TabsContent>
            )}
            <TabsContent value="movements" className="pt-4">
              <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                <TransactionsTable
                  channels={channels}
                  actorAccess={ctx.access}
                  initialParams={listParams}
                  fixedAccountId={account.id}
                />
              </Suspense>
            </TabsContent>
          </Tabs>
        </Hydrate>
      ) : (
        <p className="text-muted-foreground text-sm">
          No tenés permiso para ver los movimientos de las cuentas.
        </p>
      )}
    </div>
  );
}
