import { Scale } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageSideProvider } from "@/components/providers/scope-provider";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  getReceivedVoucherCountsAction,
  listReceivedVouchersAction,
} from "@/features/purchase-invoices/actions/arca-received-actions";
import { ArcaReceivedTray } from "@/features/purchase-invoices/components/arca-received-tray";
import { ARCA_RECONCILIATION_PURCHASES_HREF } from "@/features/purchase-invoices/lib/arca-reconciliation";
import { arcaReceivedKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { isReceivedVoucherTab } from "@/features/purchase-invoices/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

const FIRST_PAGE: { fecha: string; id: string } | null = null;

export default async function ArcaReceivedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    redirect("/purchases");
  }
  // The tab to open: the Conciliación links a voucher to its tab.
  const { estado } = await searchParams;
  // Any other value (the retired «Cargadas», estado=confirmed) opens Pendientes.
  const status = isReceivedVoucherTab(estado) ? estado : "pending_review";

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: arcaReceivedKeys.list(status),
      queryFn: ({
        pageParam,
      }: {
        pageParam: { fecha: string; id: string } | null;
      }) =>
        runAction(() =>
          listReceivedVouchersAction({
            status,
            cursor: pageParam,
          }),
        ),
      initialPageParam: FIRST_PAGE,
    },
    {
      queryKey: arcaReceivedKeys.counts(),
      queryFn: () => runAction(() => getReceivedVoucherCountsAction()),
    },
  ]);

  return (
    <PageSideProvider side="fiscal">
      <div className="space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/purchases">Compras</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Recibidos de ARCA</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <PageHeader
          title="Recibidos de ARCA"
          description="Los comprobantes que tus proveedores informaron a ARCA. Aceptá cada uno para cargarlo como compra, o descartalo si no corresponde."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href={ARCA_RECONCILIATION_PURCHASES_HREF}>
                <Scale />
                Conciliación con ARCA
              </Link>
            </Button>
          }
        />
        <Hydrate state={dehydratedState}>
          <ArcaReceivedTray initialStatus={status} />
        </Hydrate>
      </div>
    </PageSideProvider>
  );
}
