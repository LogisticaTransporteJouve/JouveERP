import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  getCaeaStatusAction,
  listInvoicingChannelsAction,
  loadAfipAdminAction,
} from "@/features/afip-admin/actions/afip-admin-actions";
import { getArcaWebAccountAction } from "@/features/afip-admin/actions/arca-web-account-actions";
import { ArcaWebAccountPanel } from "@/features/afip-admin/components/arca-web-account-panel";
import { CaeaPanel } from "@/features/afip-admin/components/caea-panel";
import { SalesPointsPanel } from "@/features/afip-admin/components/sales-points-panel";
import { afipAdminKeys } from "@/features/afip-admin/lib/afip-admin-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function AfipSalesPointsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "afip:admin")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: afipAdminKeys.panel(),
      queryFn: () => runAction(() => loadAfipAdminAction()),
    },
    {
      queryKey: afipAdminKeys.caea(),
      queryFn: () => runAction(() => getCaeaStatusAction()),
    },
    // The sales points table names each channel; a suspense query left to
    // the client would call the server action during the server render.
    {
      queryKey: afipAdminKeys.channels(),
      queryFn: () => runAction(() => listInvoicingChannelsAction()),
    },
    {
      queryKey: afipAdminKeys.arcaWebAccount(),
      queryFn: () => runAction(() => getArcaWebAccountAction()),
    },
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Puntos de venta AFIP
        </h1>
        <p className="text-sm text-muted-foreground">
          Lista lo que devuelve{" "}
          <code className="font-mono">FEParamGetPtosVenta</code> contra el CUIT
          configurado. Sirve para descubrir qué puntos están habilitados antes
          de seedear los canales fiscales.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <SalesPointsPanel />
          <ArcaWebAccountPanel />
          <CaeaPanel />
        </Suspense>
      </Hydrate>
    </div>
  );
}
