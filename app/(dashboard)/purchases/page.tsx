import { redirect } from "next/navigation";

import { PurchaseInvoiceFileAssistBinding } from "@/features/ai/document/components/purchase-invoice-file-assist";
import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { ArcaReceivedLink } from "@/features/purchase-invoices/components/arca-received-link";
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
import { readPageChannelScope } from "@/lib/scope-server";

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

  const rawParams = await searchParams;
  const params = parsePurchaseListParams(rawParams);
  const scope = await readPageChannelScope(rawParams);
  const isFiscalSide = scope.isFiscal;
  const filters = purchaseListFilters(params, scope);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isFiscalSide ? "Comprobantes" : "Remitos internos de compra"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isFiscalSide
              ? "Facturas, notas de crédito y débito recibidas de proveedores de Compras."
              : "Compras a proveedores de Otras compras, sin factura: no van al Libro IVA."}
          </p>
        </div>
        {/* The ARCA tray lives in Compras: it routes each voucher by supplier. */}
        {isFiscalSide &&
          !scope.channelId &&
          userCan(ctx.access, "purchase_invoices:write") && (
            <ArcaReceivedLink />
          )}
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
