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
import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import {
  getClientAccountAction,
  getClientOpeningBalanceAction,
} from "@/features/clients/actions/account-actions";
import { getClientByIdAction } from "@/features/clients/actions/clients-actions";
import { ClientAccountTab } from "@/features/clients/components/client-account-tab";
import { ClientForm } from "@/features/clients/components/client-form";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { IVA_CONDITION_LABEL } from "@/features/clients/schema";
import { AttachmentsZone } from "@/features/files/components/attachments-zone";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
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
  // Independent reads in parallel: the client row, the pickers' channels and
  // accounts, and the cuenta-corriente prefetch (a not-found id just wastes
  // the prefetch; the account actions validate the id themselves).
  const [result, activeChannels, accountsResult, dehydratedState] =
    await Promise.all([
      getClientByIdAction(id),
      getActiveInvoicingChannels(),
      listAccountsAction(),
      prefetchQueries([
        {
          queryKey: clientsKeys.account(id),
          queryFn: () => runAction(() => getClientAccountAction(id)),
        },
        {
          queryKey: clientsKeys.openingBalance(id),
          queryFn: () => runAction(() => getClientOpeningBalanceAction(id)),
        },
      ]),
    ]);
  if (!result.ok) {
    redirect("/clients");
  }
  if (!result.data) {
    notFound();
  }

  const client = result.data;
  const canWrite = userCan(ctx.roles, "clients:write");

  // Channels + accounts so the cuenta-corriente tab can render the
  // New invoice / New receipt dialogs with this client pre-selected.
  const channels = activeChannels.map((c) => ({
    id: c.id,
    name: c.name,
    division: c.division,
    is_fiscal: c.is_fiscal,
  }));
  const accounts = accountsResult.ok ? accountsResult.data : [];

  return (
    <div className="space-y-6">
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
          <TabsTrigger value="files">Adjuntos</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-4">
          <Hydrate state={dehydratedState}>
            <Suspense fallback={<Loading />}>
              <ClientAccountTab
                clientId={id}
                client={{
                  id: client.id,
                  legal_name: client.legal_name,
                  display_name: client.display_name,
                  cuit: client.cuit,
                  iva_condition: client.iva_condition,
                }}
                channels={channels}
                accounts={accounts}
                actorRoles={ctx.roles}
              />
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

        <TabsContent value="files" className="mt-4 max-w-3xl">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Adjuntos del cliente</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Constancia de inscripción, contratos, otros documentos.
            </p>
            <div className="mt-3">
              <AttachmentsZone
                targetType="client"
                targetId={client.id}
                canWrite={userCan(ctx.roles, "files:write") && canWrite}
                canDelete={userCan(ctx.roles, "files:write") && canWrite}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
