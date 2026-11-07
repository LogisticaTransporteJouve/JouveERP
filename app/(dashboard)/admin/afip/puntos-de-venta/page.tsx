import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getCaeaStatusAction,
  listInvoicingChannelsAction,
  loadAfipAdminAction,
} from "@/features/afip-admin/actions/afip-admin-actions";
import { ArcaReconciliationPanel } from "@/features/afip-admin/components/arca-reconciliation-panel";
import { CaeaPanel } from "@/features/afip-admin/components/caea-panel";
import { SalesPointsPanel } from "@/features/afip-admin/components/sales-points-panel";
import { afipAdminKeys } from "@/features/afip-admin/lib/afip-admin-keys";
import { getArcaReconciliationMonthsAction } from "@/features/purchase-invoices/actions/arca-reconciliation-actions";
import { ArcaReconciliationSection } from "@/features/purchase-invoices/components/arca-reconciliation";
import { arcaReceivedKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries, type PrefetchEntry } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function AfipSalesPointsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  // The sales points and CAEA are afip:admin's; the Conciliación con ARCA
  // block also shows its Compras tab to whoever loads purchases.
  const canSales = userCan(ctx.access, "afip:admin");
  const canPurchases = userCan(ctx.access, "purchase_invoices:write");
  if (!canSales && !canPurchases) {
    redirect("/dashboard");
  }
  const { tab: requested } = await searchParams;
  const tab =
    !canSales || (requested === "compras" && canPurchases)
      ? "compras"
      : "ventas";

  const queries: PrefetchEntry[] = [];
  if (canSales) {
    queries.push(
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
    );
  }
  // Only the tab that opens: the other one renders when it is picked.
  if (tab === "compras") {
    queries.push({
      queryKey: arcaReceivedKeys.reconciliation(),
      queryFn: () => runAction(() => getArcaReconciliationMonthsAction()),
    });
  }
  const dehydratedState = await prefetchQueries(queries);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Puntos de venta AFIP
        </h1>
        {canSales && (
          <p className="text-sm text-muted-foreground">
            Lista lo que devuelve{" "}
            <code className="font-mono">FEParamGetPtosVenta</code> contra el
            CUIT configurado. Sirve para descubrir qué puntos están habilitados
            antes de seedear los canales fiscales.
          </p>
        )}
      </div>
      <Hydrate state={dehydratedState}>
        {canSales && (
          <Suspense fallback={<Loading />}>
            <SalesPointsPanel />
          </Suspense>
        )}

        <section id="conciliacion" className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Conciliación con ARCA</h2>
            <p className="text-sm text-muted-foreground">
              Lo que ARCA tiene contra lo que tiene el ERP: en ventas, la
              numeración de cada punto de venta; en compras, los comprobantes
              que ARCA lista como recibidos contra las compras fiscales.
            </p>
          </div>
          <Tabs defaultValue={tab}>
            <TabsList>
              {canSales && <TabsTrigger value="ventas">Ventas</TabsTrigger>}
              {canPurchases && (
                <TabsTrigger value="compras">Compras</TabsTrigger>
              )}
            </TabsList>
            {canSales && (
              <TabsContent value="ventas">
                <ArcaReconciliationPanel />
              </TabsContent>
            )}
            {canPurchases && (
              <TabsContent value="compras">
                <ArcaReconciliationSection />
              </TabsContent>
            )}
          </Tabs>
        </section>

        {canSales && (
          <Suspense fallback={<Loading />}>
            <CaeaPanel />
          </Suspense>
        )}
      </Hydrate>
    </div>
  );
}
