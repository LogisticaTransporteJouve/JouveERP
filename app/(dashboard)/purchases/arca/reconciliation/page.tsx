import { redirect } from "next/navigation";

import { PageSideProvider } from "@/components/providers/scope-provider";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { getArcaReconciliationMonthsAction } from "@/features/purchase-invoices/actions/arca-reconciliation-actions";
import { ArcaReconciliation } from "@/features/purchase-invoices/components/arca-reconciliation";
import { arcaReceivedKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ArcaReconciliationPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    redirect("/purchases");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: arcaReceivedKeys.reconciliation(),
      queryFn: () => runAction(() => getArcaReconciliationMonthsAction()),
    },
  ]);

  return (
    <PageSideProvider side="fiscal">
      <div className="space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/purchases">Compras</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/purchases/arca">
                Recibidos de ARCA
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Conciliación</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <PageHeader
          title="Conciliación con ARCA"
          description="Lo que ARCA lista como recibido contra las compras fiscales del ERP. Cada proveedor numera sus comprobantes, así que se comparan uno por uno: proveedor (CUIT), tipo, letra, punto de venta y número."
        />
        <Hydrate state={dehydratedState}>
          <ArcaReconciliation />
        </Hydrate>
      </div>
    </PageSideProvider>
  );
}
