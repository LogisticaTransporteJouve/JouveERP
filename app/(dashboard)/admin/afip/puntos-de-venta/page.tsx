import { redirect } from "next/navigation";
import { Suspense } from "react";

import { loadAfipAdminAction } from "@/features/afip-admin/actions/afip-admin-actions";
import { SalesPointsPanel } from "@/features/afip-admin/components/sales-points-panel";
import { afipAdminKeys } from "@/features/afip-admin/lib/afip-admin-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export default async function AfipSalesPointsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "afip:admin")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: afipAdminKeys.panel(),
      queryFn: () => runAction(() => loadAfipAdminAction()),
    },
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Puntos de venta AFIP
        </h1>
        <p className="text-sm text-muted-foreground">
          Lista lo que devuelve <code className="font-mono">FEParamGetPtosVenta</code>
          {" "}contra el CUIT configurado. Sirve para descubrir qué puntos están
          habilitados antes de seedear los canales fiscales.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <SalesPointsPanel />
        </Suspense>
      </Hydrate>
    </div>
  );
}
