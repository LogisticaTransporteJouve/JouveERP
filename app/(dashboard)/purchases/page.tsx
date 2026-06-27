import { redirect } from "next/navigation";

import { ExportPdfButton } from "@/components/export-pdf-button";
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
  searchParams: Promise<{ q?: string; status?: string; type?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  const initialStatus = params.status ?? null;
  const initialFiscalFilter =
    params.type === "fiscal" || params.type === "internal" ? params.type : null;
  const isFiscalParam =
    initialFiscalFilter === "fiscal"
      ? true
      : initialFiscalFilter === "internal"
        ? false
        : null;

  const filters = {
    query: initialQuery,
    supplierId: null,
    channelId: null,
    status: initialStatus,
    fechaFrom: null,
    fechaTo: null,
    isFiscal: isFiscalParam,
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
            Facturas de compra
          </h1>
          <p className="text-sm text-muted-foreground">
            Facturas, notas de crédito y débito recibidas de proveedores +
            gastos internos sin factura formal.
          </p>
        </div>
        <ExportPdfButton resource="purchase-invoices" label="Exportar PDF" />
      </div>
      <Hydrate state={dehydratedState}>
        <PurchaseInvoicesTable
          actorRoles={ctx.roles}
          initialQuery={initialQuery}
          initialStatus={initialStatus}
          initialFiscalFilter={initialFiscalFilter}
        />
      </Hydrate>
    </div>
  );
}
