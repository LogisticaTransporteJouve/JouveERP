import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExportButton } from "@/components/export-button";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import { SupplierAgingTable } from "@/features/suppliers/components/supplier-aging-table";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { requireUserContext } from "@/lib/auth/context";
import { SUPPLIER_AGING_PERMISSIONS, userCanAll } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function AgingSuppliersPage() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, SUPPLIER_AGING_PERMISSIONS)) {
    redirect("/dashboard");
  }

  const isFiscal = isFiscalFor(await readScopeCookie());
  const dehydratedState = await prefetchQueries([
    {
      queryKey: suppliersKeys.aging(isFiscal),
      queryFn: () => runAction(() => getSupplierAgingAction({ isFiscal })),
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
        <ExportButton resource="supplier-aging" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <SupplierAgingTable />
        </Suspense>
      </Hydrate>
    </div>
  );
}
