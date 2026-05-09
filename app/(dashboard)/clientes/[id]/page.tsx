import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ClientForm } from "@/features/clients/components/client-form";
import { getClientByIdAction } from "@/features/clients/actions/clients-actions";
import { IVA_CONDITION_LABEL } from "@/features/clients/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const result = await getClientByIdAction(id);
  if (!result.ok) {
    redirect("/clientes");
  }
  if (!result.data) {
    notFound();
  }

  const client = result.data;
  const canWrite = userCan(ctx.roles, "clients:write");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/clientes"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Volver a clientes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {client.legal_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          CUIT {client.cuit} · {IVA_CONDITION_LABEL[client.iva_condition]}
          {!client.is_active && " · Inactivo"}
        </p>
      </div>
      {canWrite ? (
        <ClientForm mode="edit" client={client} />
      ) : (
        <div className="rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground">
          No tenés permiso para editar clientes.
        </div>
      )}
    </div>
  );
}
