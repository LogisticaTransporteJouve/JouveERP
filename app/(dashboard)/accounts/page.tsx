import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { AccountsTable } from "@/features/accounts/components/accounts-table";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { requireUserContext } from "@/lib/auth/context";
import { treasurySummaryQuery } from "@/features/treasury/lib/treasury-queries";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function CuentasPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounts:read")) {
    redirect("/dashboard");
  }
  // The accounts live in Tesorería › Resumen; this page stays for whoever
  // can see accounts but not the treasury totals.
  if (userCanAll(ctx.access, TREASURY_PERMISSIONS)) redirect("/treasury");

  // Shared (React cache) with the dashboard layout's channel read.
  const channelsData = await getActiveInvoicingChannels();
  const channels = channelsData.map((c) => ({ id: c.id, name: c.name }));

  const dehydratedState = await prefetchQueries([
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
    ...(userCanAll(ctx.access, TREASURY_PERMISSIONS)
      ? [treasurySummaryQuery()]
      : []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cuentas</h1>
          <p className="text-sm text-muted-foreground">
            Caja, bancos, billeteras, inversiones y cheques en cartera, con su
            saldo actual y el cambio contra el cierre del mes anterior. Entrá a
            una cuenta para ver sus movimientos y su extracto.
          </p>
        </div>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <AccountsTable actorAccess={ctx.access} channels={channels} />
        </Suspense>
      </Hydrate>
    </div>
  );
}
