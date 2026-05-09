import { redirect } from "next/navigation";

import { ClientsTable } from "@/features/clients/components/clients-table";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  const initialOnlyActive = params.inactive !== "1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo único por CUIT, compartido entre Logística Jouve y DZ
          Instalaciones.
        </p>
      </div>
      <ClientsTable
        actorRoles={ctx.roles}
        initialQuery={initialQuery}
        initialOnlyActive={initialOnlyActive}
      />
    </div>
  );
}
