import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getClientAccountAction } from "@/features/clients/actions/account-actions";
import { getClientByIdAction } from "@/features/clients/actions/clients-actions";
import { ClientAccountTab } from "@/features/clients/components/client-account-tab";
import { ClientForm } from "@/features/clients/components/client-form";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { IVA_CONDITION_LABEL } from "@/features/clients/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

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
    redirect("/clients");
  }
  if (!result.data) {
    notFound();
  }

  const client = result.data;
  const canWrite = userCan(ctx.roles, "clients:write");

  const dehydratedState = await prefetchQueries([
    {
      queryKey: clientsKeys.account(id),
      queryFn: () => runAction(() => getClientAccountAction(id)),
    },
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/clients">Clientes</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{client.legal_name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {client.legal_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          CUIT {client.cuit} · {IVA_CONDITION_LABEL[client.iva_condition]}
          {!client.is_active && " · Inactivo"}
        </p>
      </div>

      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Cuenta corriente</TabsTrigger>
          <TabsTrigger value="data">Datos</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-4">
          <Hydrate state={dehydratedState}>
            <Suspense fallback={<Loading />}>
              <ClientAccountTab clientId={id} />
            </Suspense>
          </Hydrate>
        </TabsContent>

        <TabsContent value="data" className="mt-4 max-w-3xl">
          {canWrite ? (
            <ClientForm mode="edit" client={client} />
          ) : (
            <div className="rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground">
              No tenés permiso para editar clientes.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
