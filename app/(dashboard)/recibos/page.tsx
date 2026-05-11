import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listReceiptsAction } from "@/features/receipts/actions/receipts-actions";
import { ReceiptsTable } from "@/features/receipts/components/receipts-table";
import { receiptsKeys } from "@/features/receipts/lib/receipts-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function RecibosPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    redirect("/dashboard");
  }

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
      queryKey: receiptsKeys.list(),
      queryFn: () => runAction(() => listReceiptsAction()),
    },
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Recibos</h1>
        <p className="text-sm text-muted-foreground">
          Cobros de clientes con imputación a comprobantes. Numerador
          independiente por canal: <span className="font-mono">R0003-…</span>.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <ReceiptsTable channels={channels} actorRoles={ctx.roles} />
        </Suspense>
      </Hydrate>
    </div>
  );
}
