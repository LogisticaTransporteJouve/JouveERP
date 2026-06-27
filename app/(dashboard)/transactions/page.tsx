import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listTransactionsAction } from "@/features/transactions/actions/transactions-actions";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import { ExportPdfButton } from "@/components/export-pdf-button";
import { TRANSACTIONS_PAGE_SIZE } from "@/features/transactions/hooks/use-transactions";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import {
  TRANSACTION_KINDS,
  type TransactionKind,
} from "@/features/transactions/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

function asKind(value: string | undefined): TransactionKind | null {
  if (!value) return null;
  return (TRANSACTION_KINDS as readonly string[]).includes(value)
    ? (value as TransactionKind)
    : null;
}

function asISODate(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{
    channel?: string;
    account?: string;
    kind?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "transactions:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const filters = {
    channel_id: params.channel ?? null,
    account_id: params.account ?? null,
    kind: asKind(params.kind),
    date_from: asISODate(params.from),
    date_to: asISODate(params.to),
  };

  const supabase = await createSupabaseClient();
  const { data: channelsData } = await supabase
    .from("invoicing_channels")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name");

  const channels = (channelsData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: transactionsKeys.list(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listTransactionsAction({
            ...filters,
            offset: pageParam,
            limit: TRANSACTIONS_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
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
          <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
          <p className="text-sm text-muted-foreground">
            Ingresos, egresos y transferencias entre cuentas. Cada movimiento
            se imputa a un canal (Jouve o DZ) para reportes por división.
          </p>
        </div>
        <ExportPdfButton resource="transactions" label="Exportar PDF" />
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <TransactionsTable
            channels={channels}
            actorRoles={ctx.roles}
            initialChannel={filters.channel_id}
            initialAccount={filters.account_id}
            initialKind={filters.kind}
            initialDateFrom={filters.date_from}
            initialDateTo={filters.date_to}
          />
        </Suspense>
      </Hydrate>
    </div>
  );
}
