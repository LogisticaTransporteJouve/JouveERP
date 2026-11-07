import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listChecksAction } from "@/features/checks/actions/checks-actions";
import { CheckSalesSection } from "@/features/checks/components/check-sales-section";
import { ChequesTable } from "@/features/checks/components/checks-table";
import { EcheqListadoDialog } from "@/features/receipts/components/echeq-listado-dialog";
import {
  CHECK_CASH_DENIED_REASON,
  CHECK_CASH_PERMISSIONS,
} from "@/features/checks/lib/check-cash";
import { checksKeys } from "@/features/checks/lib/checks-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { getInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readSharedScope } from "@/lib/scope-server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function ChequesPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:read")) {
    redirect("/dashboard");
  }

  // Shared (React cache) with the dashboard layout's channel read. All of
  // them, inactive included: a check's channel is shown by name even when it
  // can no longer be picked.
  const channels = (await getInvoicingChannels()).map((c) => ({
    id: c.id,
    name: c.name,
    is_active: c.is_active,
  }));

  const isFiscal = isFiscalFor(await readSharedScope());
  const dehydratedState = await prefetchQueries([
    {
      queryKey: checksKeys.list(isFiscal),
      queryFn: () => runAction(() => listChecksAction({ isFiscal })),
    },
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cheques</h1>
          <p className="text-sm text-muted-foreground">
            Cartera de cheques físicos y e-cheq. Lifecycle: en cartera →
            depositar / endosar / rechazar → acreditar.
          </p>
        </div>
        {userCanAll(ctx.access, [
          "receipts:write",
          "cheques:write",
          "transactions:write",
        ]) && <EcheqListadoDialog />}
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <ChequesTable channels={channels} actorAccess={ctx.access} />
        </Suspense>
        <Suspense fallback={null}>
          <CheckSalesSection
            canCancel={userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)}
            canPay={
              userCanAll(ctx.access, CHECK_CASH_PERMISSIONS) &&
              userCan(ctx.access, "accounts:read")
            }
            payDeniedReason={
              userCan(ctx.access, "cheques:write") &&
              !userCan(ctx.access, "transactions:write")
                ? CHECK_CASH_DENIED_REASON
                : null
            }
          />
        </Suspense>
      </Hydrate>
    </div>
  );
}
