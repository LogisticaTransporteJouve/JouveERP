import { redirect } from "next/navigation";

import { listComprobantesAction } from "@/features/comprobantes/actions/comprobantes-actions";
import { ComprobantesTable } from "@/features/comprobantes/components/comprobantes-table";
import { COMPROBANTES_PAGE_SIZE } from "@/features/comprobantes/hooks/use-comprobantes";
import { comprobantesKeys } from "@/features/comprobantes/lib/comprobantes-keys";
import {
  COMPROBANTE_STATUSES,
  type ComprobanteStatus,
} from "@/features/comprobantes/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function asStatus(value: string | undefined): ComprobanteStatus | null {
  if (!value) return null;
  return (COMPROBANTE_STATUSES as readonly string[]).includes(value)
    ? (value as ComprobanteStatus)
    : null;
}

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<{
    channel?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const supabase = getServiceClient();
  const { data: channels } = await supabase
    .from("invoicing_channels")
    .select("id, name, division, is_fiscal, is_active")
    .eq("is_active", true)
    .order("name");

  const filters = {
    channel: params.channel ?? null,
    status: asStatus(params.status),
    query: params.q ?? "",
  };

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: comprobantesKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listComprobantesAction({
            channel_id: filters.channel,
            status: filters.status,
            query: filters.query.length > 0 ? filters.query : null,
            offset: pageParam,
            limit: COMPROBANTES_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Comprobantes</h1>
        <p className="text-sm text-muted-foreground">
          Facturas, notas de crédito y débito por canal.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <ComprobantesTable
          actorRoles={ctx.roles}
          channels={(channels ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            division: c.division,
            is_fiscal: c.is_fiscal,
          }))}
          initialChannel={filters.channel}
          initialStatus={filters.status}
          initialQuery={filters.query}
        />
      </Hydrate>
    </div>
  );
}
