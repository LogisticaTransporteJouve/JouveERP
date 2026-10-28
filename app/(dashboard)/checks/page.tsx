import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExportButton } from "@/components/export-button";
import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listChecksAction } from "@/features/checks/actions/checks-actions";
import { ChequesTable } from "@/features/checks/components/checks-table";
import { checksKeys } from "@/features/checks/lib/checks-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function ChequesPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:read")) {
    redirect("/dashboard");
  }

  // Shared (React cache) with the dashboard layout's channel read.
  const channelsData = await getActiveInvoicingChannels();

  const channels = channelsData.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const dehydratedState = await prefetchQueries([
    {
      queryKey: checksKeys.list(),
      queryFn: () => runAction(() => listChecksAction()),
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
          <h1 className="text-2xl font-semibold tracking-tight">Cheques</h1>
          <p className="text-sm text-muted-foreground">
            Cartera de cheques físicos y e-cheq. Lifecycle: en cartera →
            depositar / endosar / rechazar → acreditar.
          </p>
        </div>
        <ExportButton resource="checks" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <ChequesTable channels={channels} actorAccess={ctx.access} />
        </Suspense>
      </Hydrate>
    </div>
  );
}
