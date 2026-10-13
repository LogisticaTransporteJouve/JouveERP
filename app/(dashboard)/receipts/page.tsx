import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExportPdfButton } from "@/components/export-pdf-button";
import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listReceiptsAction } from "@/features/receipts/actions/receipts-actions";
import { ReceiptsTable } from "@/features/receipts/components/receipts-table";
import { receiptsKeys } from "@/features/receipts/lib/receipts-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function RecibosPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
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
      queryKey: receiptsKeys.list(),
      queryFn: () => runAction(() => listReceiptsAction()),
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
          <h1 className="text-2xl font-semibold tracking-tight">Recibos</h1>
          <p className="text-sm text-muted-foreground">
            Cobros de clientes con imputación a comprobantes. Numerador
            independiente por canal: <span className="font-mono">R0003-…</span>.
          </p>
        </div>
        <ExportPdfButton resource="receipts" label="Exportar PDF" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <ReceiptsTable channels={channels} actorRoles={ctx.roles} />
        </Suspense>
      </Hydrate>
    </div>
  );
}
