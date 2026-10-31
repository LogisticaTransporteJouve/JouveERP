import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExportButton } from "@/components/export-button";
import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { AgingTable } from "@/features/aging/components/aging-table";
import { agingKeys } from "@/features/aging/lib/aging-keys";
import { requireUserContext } from "@/lib/auth/context";
import { CLIENT_AGING_PERMISSIONS, userCanAll } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function AgingPage() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, CLIENT_AGING_PERMISSIONS)) {
    redirect("/dashboard");
  }

  const isFiscal = isFiscalFor(await readScopeCookie());
  const dehydratedState = await prefetchQueries([
    {
      queryKey: agingKeys.summary(isFiscal),
      queryFn: () => runAction(() => getAgingSummaryAction({ isFiscal })),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Aging de clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            Saldos pendientes por antigüedad (0–30 / 30–60 / 60–90 / 90+ días).
            Solo facturas y notas de débito emitidas con saldo abierto; las
            imputaciones de recibos descuentan automáticamente.
          </p>
        </div>
        <ExportButton resource="aging" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <AgingTable />
        </Suspense>
      </Hydrate>
    </div>
  );
}
