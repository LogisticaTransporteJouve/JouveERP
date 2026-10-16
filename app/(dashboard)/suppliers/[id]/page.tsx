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
import { PurchaseInvoiceFileAssistBinding } from "@/features/ai/document/components/purchase-invoice-file-assist";
import { AttachmentsZone } from "@/features/files/components/attachments-zone";
import { getSupplierAccountAction } from "@/features/suppliers/actions/account-actions";
import { getSupplierByIdAction } from "@/features/suppliers/actions/suppliers-actions";
import { SupplierAccountTab } from "@/features/suppliers/components/supplier-account-tab";
import { SupplierForm } from "@/features/suppliers/components/supplier-form";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { IVA_CONDITION_LABEL } from "@/features/suppliers/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  // Independent reads in parallel (see clients/[id]).
  const [result, activeChannels, accountsResult, dehydratedState] =
    await Promise.all([
      getSupplierByIdAction(id),
      getActiveInvoicingChannels(),
      listAccountsAction(),
      prefetchQueries([
        {
          queryKey: suppliersKeys.account(id),
          queryFn: () => runAction(() => getSupplierAccountAction(id)),
        },
      ]),
    ]);
  if (!result.ok) {
    redirect("/suppliers");
  }
  if (!result.data) {
    notFound();
  }

  const supplier = result.data;
  const canWrite = userCan(ctx.roles, "suppliers:write");

  const channels = activeChannels.map((c) => ({ id: c.id, name: c.name }));
  const accounts = accountsResult.ok ? accountsResult.data : [];

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/suppliers">Proveedores</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{supplier.legal_name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {supplier.legal_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          CUIT {supplier.cuit} · {IVA_CONDITION_LABEL[supplier.iva_condition]}
          {!supplier.is_active && " · Inactivo"}
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
              <PurchaseInvoiceFileAssistBinding roles={ctx.roles}>
                <SupplierAccountTab
                  supplierId={id}
                  supplier={{
                    id: supplier.id,
                    legal_name: supplier.legal_name,
                    display_name: supplier.display_name,
                    cuit: supplier.cuit,
                    iva_condition: supplier.iva_condition,
                  }}
                  channels={channels}
                  accounts={accounts}
                  actorRoles={ctx.roles}
                />
              </PurchaseInvoiceFileAssistBinding>
            </Suspense>
          </Hydrate>
        </TabsContent>

        <TabsContent value="data" className="mt-4 max-w-3xl">
          {canWrite ? (
            <SupplierForm mode="edit" supplier={supplier} />
          ) : (
            <div className="rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground">
              No tenés permiso para editar proveedores.
            </div>
          )}
        </TabsContent>

        <TabsContent value="files" className="mt-4 max-w-3xl">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Adjuntos del proveedor</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Constancia de inscripción, contratos, otros documentos.
            </p>
            <div className="mt-3">
              <AttachmentsZone
                targetType="supplier"
                targetId={supplier.id}
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
