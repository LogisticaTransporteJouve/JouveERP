import { redirect } from "next/navigation";

import { PurchaseInvoiceFileAssistBinding } from "@/features/ai/document/components/purchase-invoice-file-assist";
import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { PurchaseInvoicesTable } from "@/features/purchase-invoices/components/purchase-invoices-table";
import {
  parsePurchaseListParams,
  purchaseListFilters,
} from "@/features/purchase-invoices/lib/purchase-list-filters";
import {
  PURCHASE_INVOICES_PAGE_SIZE,
  purchaseInvoicesKeys,
} from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:read")) {
    redirect("/dashboard");
  }

  const params = parsePurchaseListParams(await searchParams);
  const isFiscalSide = isFiscalFor(await readScopeCookie());
  const filters = purchaseListFilters(params, isFiscalSide);

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
            isFiscal: filters.isFiscal,
            offset: pageParam,
            limit: PURCHASE_INVOICES_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isFiscalSide ? "Facturas de compra" : "Remitos internos de compra"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isFiscalSide
              ? "Facturas, notas de crédito y débito recibidas de proveedores de Compras."
              : "Compras a proveedores de Otras compras, sin factura: no van al Libro IVA."}
          </p>
        </div>
      </div>
      <Hydrate state={dehydratedState}>
        <PurchaseInvoiceFileAssistBinding access={ctx.access}>
          <PurchaseInvoicesTable
            actorAccess={ctx.access}
            initialParams={params}
          />
        </PurchaseInvoiceFileAssistBinding>
      </Hydrate>
    </div>
  );
}
