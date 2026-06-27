import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExportPdfButton } from "@/components/export-pdf-button";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import { SupplierAgingTable } from "@/features/suppliers/components/supplier-aging-table";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function AgingSuppliersPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: suppliersKeys.aging(),
      queryFn: () => runAction(() => getSupplierAgingAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Aging proveedores
          </h1>
          <p className="text-sm text-muted-foreground">
            Deudas con proveedores por antigüedad. Calculado en base a facturas
            de compra menos pagos imputados de OPs emitidas.
          </p>
        </div>
        <ExportPdfButton resource="supplier-aging" label="Exportar PDF" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <SupplierAgingTable />
        </Suspense>
      </Hydrate>
    </div>
  );
}
