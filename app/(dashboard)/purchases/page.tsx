import { redirect } from "next/navigation";

import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { PurchaseInvoicesTable } from "@/features/purchase-invoices/components/purchase-invoices-table";
import {
  PURCHASE_INVOICES_PAGE_SIZE,
  purchaseInvoicesKeys,
} from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  const initialStatus = params.status ?? null;

  const filters = {
    query: initialQuery,
    supplierId: null,
    channelId: null,
    status: initialStatus,
    fechaFrom: null,
    fechaTo: null,
  };

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: purchaseInvoicesKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          searchPurchaseInvoicesAction({
            query: filters.query,
            supplierId: filters.supplierId,
            channelId: filters.channelId,
            status: filters.status,
            fechaFrom: filters.fechaFrom,
            fechaTo: filters.fechaTo,
            offset: pageParam,
            limit: PURCHASE_INVOICES_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Facturas de compra
        </h1>
        <p className="text-sm text-muted-foreground">
          Facturas, notas de crédito y débito recibidas de proveedores.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <PurchaseInvoicesTable
          actorRoles={ctx.roles}
          initialQuery={initialQuery}
          initialStatus={initialStatus}
        />
      </Hydrate>
    </div>
  );
}
