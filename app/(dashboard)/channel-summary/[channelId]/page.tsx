import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { PageChannelProvider } from "@/components/providers/scope-provider";
import { getChannelSummaryAction } from "@/features/channel-summary/actions/channel-summary-actions";
import { ChannelSummary } from "@/features/channel-summary/components/channel-summary";
import { channelSummaryKeys } from "@/features/channel-summary/lib/channel-summary-keys";
import {
  defaultChannelSummaryRange,
  type ChannelSummaryInput,
} from "@/features/channel-summary/schema";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import { SupplierAgingTable } from "@/features/suppliers/components/supplier-aging-table";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { requireUserContext } from "@/lib/auth/context";
import {
  SUPPLIER_AGING_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { getSegregatedChannels } from "@/lib/channels";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { resolveChannelScope } from "@/lib/scope-server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

/** «Resumen» of a segregated channel's menu section (DZ Instalaciones): its
 *  result and its supplier balances, which the main app leaves out. */
export default async function ChannelSummaryRoute({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    redirect("/dashboard");
  }

  const { channelId: rawChannelId } = await params;
  const scope = await resolveChannelScope(rawChannelId, ctx.access, null);
  const channel = (await getSegregatedChannels()).find(
    (c) => c.id === scope.channelId,
  );
  if (!scope.channelId || !channel) notFound();

  const input: ChannelSummaryInput = {
    channelId: channel.id,
    ...defaultChannelSummaryRange(todayInAR()),
  };
  const canSeeAging = userCanAll(ctx.access, SUPPLIER_AGING_PERMISSIONS);
  const dehydratedState = await prefetchQueries([
    {
      queryKey: channelSummaryKeys.summary(input),
      queryFn: () => runAction(() => getChannelSummaryAction(input)),
    },
    ...(canSeeAging
      ? [
          {
            queryKey: suppliersKeys.aging(scope.isFiscal, channel.id),
            queryFn: () =>
              runAction(() =>
                getSupplierAgingAction({
                  isFiscal: scope.isFiscal,
                  channelId: channel.id,
                }),
              ),
          },
        ]
      : []),
  ]);

  return (
    <PageChannelProvider channelId={channel.id}>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Resumen · {channel.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Lo que esta división vendió, compró y debe. No entra en el resultado
            de gestión de Logística Jouve; sí en los libros y el Libro IVA.
          </p>
        </div>
        <Hydrate state={dehydratedState}>
          <Suspense fallback={<Loading />}>
            <ChannelSummary input={input} />
          </Suspense>
          {canSeeAging && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Saldos con proveedores</h2>
              <Suspense fallback={<Loading />}>
                <SupplierAgingTable channelId={channel.id} />
              </Suspense>
            </section>
          )}
        </Hydrate>
      </div>
    </PageChannelProvider>
  );
}
