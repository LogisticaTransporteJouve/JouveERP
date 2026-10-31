import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExportButton } from "@/components/export-button";
import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import {
  getReceiptListTotalsAction,
  listReceiptsAction,
} from "@/features/receipts/actions/receipts-actions";
import { ReceiptsTable } from "@/features/receipts/components/receipts-table";
import {
  parseReceiptListParams,
  receiptListActionInput,
  receiptListFilters,
} from "@/features/receipts/lib/receipt-list-filters";
import {
  RECEIPTS_PAGE_SIZE,
  receiptsKeys,
} from "@/features/receipts/lib/receipts-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function RecibosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    redirect("/dashboard");
  }

  const params = parseReceiptListParams(await searchParams);
  const supabase = await createSupabaseClient();
  const [channelsData, { data: client }] = await Promise.all([
    // Shared (React cache) with the dashboard layout's channel read.
    getActiveInvoicingChannels(),
    params.clientId
      ? supabase
          .from("clients")
          .select("id, legal_name")
          .eq("id", params.clientId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const channels = channelsData.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const filters = receiptListFilters(
    params,
    isFiscalFor(await readScopeCookie()),
  );
  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: receiptsKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listReceiptsAction(
            receiptListActionInput(filters, pageParam, RECEIPTS_PAGE_SIZE),
          ),
        ),
      initialPageParam: 0,
    },
    {
      queryKey: receiptsKeys.totals(filters, params.group),
      queryFn: () =>
        runAction(() =>
          getReceiptListTotalsAction({ ...filters, group: params.group }),
        ),
    },
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Recibos</h1>
          <p className="text-sm text-muted-foreground">
            Cobros de clientes con imputación a comprobantes. Numerador
            independiente por canal: <span className="font-mono">R0003-…</span>.
          </p>
        </div>
        <ExportButton resource="receipts" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <ReceiptsTable
            channels={channels}
            actorAccess={ctx.access}
            initialParams={params}
            initialClient={client ?? null}
          />
        </Suspense>
      </Hydrate>
    </div>
  );
}
