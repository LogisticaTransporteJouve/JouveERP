import { notFound, redirect } from "next/navigation";

import {
  PageChannelProvider,
  PageSideProvider,
} from "@/components/providers/scope-provider";
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
import { counterpartyIdentityLabel } from "@/features/clients/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { scopedHref } from "@/lib/scope";
import { readPageChannelScope, resolveChannelScope } from "@/lib/scope-server";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const result = await getSupplierByIdAction(id);
  if (!result.ok) {
    redirect("/suppliers");
  }
  if (!result.data) {
    notFound();
  }
  // A supplier lives on one side: its page shows that side (see clients/[id]).
  const isFiscal = result.data.is_fiscal;
  // Opened from a segregated channel's section, or a supplier whose default
  // channel is segregated: the page shows that channel's account only.
  const defaultChannelId = result.data.default_channel_id;
  const [urlScope, defaultScope] = await Promise.all([
    readPageChannelScope(await searchParams),
    resolveChannelScope(defaultChannelId, ctx.access, isFiscal),
  ]);
  const channelId = urlScope.channelId ?? defaultScope.channelId;
  const [accountsResult, dehydratedState] = await Promise.all([
    listAccountsAction(),
    prefetchQueries([
      {
        queryKey: suppliersKeys.accountByScope(id, isFiscal, channelId),
        queryFn: () =>
          runAction(() =>
            getSupplierAccountAction(id, { isFiscal, channelId }),
          ),
      },
    ]),
  ]);

  const supplier = result.data;
  const canWrite = userCan(ctx.access, "suppliers:write");

  const accounts = accountsResult.ok ? accountsResult.data : [];

  return (
    <PageChannelProvider channelId={channelId}>
      <PageSideProvider side={isFiscal ? "fiscal" : "internal"}>
        <div className="space-y-6">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href={scopedHref("/suppliers", channelId)}>
                  Proveedores
                </BreadcrumbLink>
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
              {counterpartyIdentityLabel(supplier)}
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
                  <PurchaseInvoiceFileAssistBinding access={ctx.access}>
                    <SupplierAccountTab
                      supplierId={id}
                      supplier={{
                        id: supplier.id,
                        legal_name: supplier.legal_name,
                        display_name: supplier.display_name,
                        cuit: supplier.cuit,
                        iva_condition: supplier.iva_condition,
                        is_fiscal: supplier.is_fiscal,
                      }}
                      accounts={accounts}
                      actorAccess={ctx.access}
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
                    canWrite={userCan(ctx.access, "files:write") && canWrite}
                    canDelete={userCan(ctx.access, "files:write") && canWrite}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </PageSideProvider>
    </PageChannelProvider>
  );
}
