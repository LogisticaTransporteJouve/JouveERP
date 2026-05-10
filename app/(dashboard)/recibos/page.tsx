import { redirect } from "next/navigation";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { listReceiptsAction } from "@/features/receipts/actions/receipts-actions";
import { ReceiptsTable } from "@/features/receipts/components/receipts-table";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export default async function RecibosPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    redirect("/dashboard");
  }

  const supabase = await createSupabaseClient();
  const [receiptsRes, accountsRes, channelsRes] = await Promise.all([
    listReceiptsAction(),
    listAccountsAction(),
    supabase
      .from("invoicing_channels")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
  ]);

  const receipts = receiptsRes.ok ? receiptsRes.data.receipts : [];
  const accounts = accountsRes.ok ? accountsRes.data : [];
  const channels = (channelsRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const error = !receiptsRes.ok
    ? receiptsRes.error
    : !accountsRes.ok
      ? accountsRes.error
      : channelsRes.error?.message;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recibos</h1>
        <p className="text-sm text-muted-foreground">
          Cobros de clientes con imputación a comprobantes. Numerador
          independiente por canal: <span className="font-mono">R0003-…</span>.
        </p>
      </div>
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <ReceiptsTable
          receipts={receipts}
          channels={channels}
          accounts={accounts}
          actorRoles={ctx.roles}
        />
      )}
    </div>
  );
}
