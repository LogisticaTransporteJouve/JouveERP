import { redirect } from "next/navigation";

import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { AccountsTable } from "@/features/accounts/components/accounts-table";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { SoldChecksExposureCard } from "@/features/checks/components/sold-checks-exposure-card";
import { TreasuryPage } from "@/features/treasury/components/treasury-page";
import { treasurySummaryQuery } from "@/features/treasury/lib/treasury-queries";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function TreasuryRoute() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    redirect("/dashboard");
  }
  const canReadAccounts = userCan(ctx.access, "accounts:read");
  const channels = (await getActiveInvoicingChannels()).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const dehydratedState = await prefetchQueries([
    treasurySummaryQuery(),
    ...(canReadAccounts
      ? [
          {
            queryKey: accountsKeys.list(),
            queryFn: () => runAction(() => listAccountsAction()),
          },
        ]
      : []),
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <TreasuryPage
          canCollect={userCan(ctx.access, "receipts:write")}
          canPay={userCan(ctx.access, "payment_orders:write")}
          canEditRetentions={userCan(ctx.access, "retentions:write")}
          canAdvance={
            userCan(ctx.access, "hr:write") &&
            userCan(ctx.access, "transactions:write")
          }
        />
        {canReadAccounts && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Cuentas</h2>
            <p className="text-sm text-muted-foreground">
              Entrá a una cuenta para ver sus movimientos y su extracto.
            </p>
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <AccountsTable actorAccess={ctx.access} channels={channels} />
            </Suspense>
          </section>
        )}
        {userCan(ctx.access, "cheques:read") && <SoldChecksExposureCard />}
      </div>
    </Hydrate>
  );
}
