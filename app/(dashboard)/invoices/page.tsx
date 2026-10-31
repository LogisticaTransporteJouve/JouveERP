import { redirect } from "next/navigation";

import { listInvoicesAction } from "@/features/invoices/actions/invoices-actions";
import { ComprobantesTable } from "@/features/invoices/components/invoices-table";
import {
  INVOICES_PAGE_SIZE,
  invoicesKeys,
} from "@/features/invoices/lib/invoices-keys";
import {
  INVOICE_STATUSES,
  type InvoiceStatus,
} from "@/features/invoices/schema";
import { requireUserContext } from "@/lib/auth/context";
import { isFiscalOnly, userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function asStatus(value: string | undefined): InvoiceStatus | null {
  if (!value) return null;
  return (INVOICE_STATUSES as readonly string[]).includes(value)
    ? (value as InvoiceStatus)
    : null;
}

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
  }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const supabase = getServiceClient();
  const { data: channels } = await supabase
    .from("invoicing_channels")
    .select("id, name, is_fiscal, is_active")
    .eq("is_active", true)
    .order("name");
  const visibleChannels = (channels ?? []).filter(
    (c) => !isFiscalOnly(ctx.access) || c.is_fiscal,
  );

  const filters = {
    isFiscal: isFiscalFor(await readScopeCookie()),
    status: asStatus(params.status),
    query: params.q ?? "",
  };

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: invoicesKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listInvoicesAction({
            isFiscal: filters.isFiscal,
            status: filters.status,
            query: filters.query.length > 0 ? filters.query : null,
            offset: pageParam,
            limit: INVOICES_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Comprobantes</h1>
        <p className="text-sm text-muted-foreground">
          Facturas, notas de crédito y débito por canal.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <ComprobantesTable
          actorAccess={ctx.access}
          channels={visibleChannels.map((c) => ({
            id: c.id,
            name: c.name,
            is_fiscal: c.is_fiscal,
          }))}
          initialStatus={filters.status}
          initialQuery={filters.query}
        />
      </Hydrate>
    </div>
  );
}
