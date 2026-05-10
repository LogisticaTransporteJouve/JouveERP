import { redirect } from "next/navigation";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { AccountsTable } from "@/features/accounts/components/accounts-table";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export default async function CuentasPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounts:read")) {
    redirect("/dashboard");
  }

  const result = await listAccountsAction();
  const accounts = result.ok ? result.data : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cuentas</h1>
        <p className="text-sm text-muted-foreground">
          Caja, bancos, billeteras, inversiones y cheques en cartera. Los
          movimientos y saldos en vivo se agregan en una fase posterior.
        </p>
      </div>
      {!result.ok ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {result.error}
        </div>
      ) : (
        <AccountsTable accounts={accounts} actorRoles={ctx.roles} />
      )}
    </div>
  );
}
