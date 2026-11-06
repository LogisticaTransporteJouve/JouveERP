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
import {
  getReceivedVoucherCountsAction,
  listReceivedVouchersAction,
} from "@/features/purchase-invoices/actions/arca-received-actions";
import { ArcaReceivedTray } from "@/features/purchase-invoices/components/arca-received-tray";
import { ARCA_BULK_ACCEPT_PERMISSIONS } from "@/features/purchase-invoices/lib/arca-bulk-accept";
import { arcaReceivedKeys } from "@/features/purchase-invoices/lib/purchase-invoices-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

const FIRST_PAGE: { fecha: string; id: string } | null = null;

export default async function ArcaReceivedPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    redirect("/purchases");
  }

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: arcaReceivedKeys.list("pending_review"),
      queryFn: ({
        pageParam,
      }: {
        pageParam: { fecha: string; id: string } | null;
      }) =>
        runAction(() =>
          listReceivedVouchersAction({
            status: "pending_review",
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
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Recibidos de ARCA
          </h1>
          <p className="text-sm text-muted-foreground">
            Los comprobantes que tus proveedores informaron a ARCA. Aceptá cada
            uno para cargarlo como compra, o descartalo si no corresponde.
          </p>
        </div>
        <Hydrate state={dehydratedState}>
          <ArcaReceivedTray
            canBulkAccept={userCanAll(ctx.access, ARCA_BULK_ACCEPT_PERMISSIONS)}
          />
        </Hydrate>
      </div>
    </PageSideProvider>
  );
}
