import { redirect } from "next/navigation";

import { ArcaSyncButton } from "@/features/afip-admin/components/arca-sync-button";
import {
  getInvoiceListTotalsAction,
  listInvoicesAction,
} from "@/features/invoices/actions/invoices-actions";
import { ComprobantesTable } from "@/features/invoices/components/invoices-table";
import {
  invoiceListActionInput,
  invoiceListFilters,
  parseInvoiceListParams,
} from "@/features/invoices/lib/invoice-list-filters";
import {
  INVOICES_PAGE_SIZE,
  invoicesKeys,
} from "@/features/invoices/lib/invoices-keys";
import { requireUserContext } from "@/lib/auth/context";
import { isFiscalOnly, userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    redirect("/dashboard");
  }

  const params = parseInvoiceListParams(await searchParams);
  const supabase = getServiceClient();
  const { data: channels } = await supabase
    .from("invoicing_channels")
    .select("id, name, is_fiscal, is_active")
    .eq("is_active", true)
    .order("name");
  const visibleChannels = (channels ?? []).filter(
    (c) => !isFiscalOnly(ctx.access) || c.is_fiscal,
  );

  const filters = invoiceListFilters(
    params,
    isFiscalFor(await readScopeCookie()),
  );
  const isFiscalSide = filters.isFiscal !== false;

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: invoicesKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listInvoicesAction(
            invoiceListActionInput(filters, pageParam, INVOICES_PAGE_SIZE),
          ),
        ),
      initialPageParam: 0,
    },
    ...(params.group
      ? [
          {
            queryKey: invoicesKeys.totals(filters, params.group),
            queryFn: () =>
              runAction(() =>
                getInvoiceListTotalsAction({ ...filters, group: params.group }),
              ),
          },
        ]
      : []),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isFiscalSide ? "Comprobantes" : "Remitos internos"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isFiscalSide
              ? "Facturas, notas de crédito y débito por canal."
              : "No van a AFIP ni llevan IVA: el precio es final."}
          </p>
        </div>
        {userCan(ctx.access, "afip:admin") && isFiscalSide && (
          <ArcaSyncButton />
        )}
      </div>
      <Hydrate state={dehydratedState}>
        <ComprobantesTable
          actorAccess={ctx.access}
          channels={visibleChannels.map((c) => ({
            id: c.id,
            name: c.name,
            is_fiscal: c.is_fiscal,
          }))}
          initialParams={params}
        />
      </Hydrate>
    </div>
  );
}
