import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { listPaymentOrdersAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { PaymentOrdersTable } from "@/features/payment-orders/components/payment-orders-table";
import {
  parsePaymentOrderListParams,
  paymentOrderListActionInput,
  paymentOrderListFilters,
} from "@/features/payment-orders/lib/payment-order-list-filters";
import {
  PAYMENT_ORDERS_PAGE_SIZE,
  paymentOrdersKeys,
} from "@/features/payment-orders/lib/payment-orders-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getActiveInvoicingChannels } from "@/lib/channels";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";

import Loading from "./loading";

export const dynamic = "force-dynamic";

export default async function PaymentOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:read")) {
    redirect("/dashboard");
  }

  // Shared (React cache) with the dashboard layout's channel read.
  const channelsData = await getActiveInvoicingChannels();

  const channels = channelsData.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const params = parsePaymentOrderListParams(await searchParams);
  const filters = paymentOrderListFilters(
    params,
    isFiscalFor(await readScopeCookie()),
  );
  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: paymentOrdersKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listPaymentOrdersAction(
            paymentOrderListActionInput(
              filters,
              pageParam,
              PAYMENT_ORDERS_PAGE_SIZE,
            ),
          ),
        ),
      initialPageParam: 0,
    },
    {
      queryKey: accountsKeys.list(),
      queryFn: () => runAction(() => listAccountsAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Órdenes de pago
          </h1>
          <p className="text-sm text-muted-foreground">
            Pagos a proveedores con imputación a facturas de compra. Numerador
            independiente por canal: <span className="font-mono">OP0003-…</span>
            .
          </p>
        </div>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <PaymentOrdersTable
            channels={channels}
            actorAccess={ctx.access}
            initialParams={params}
          />
        </Suspense>
      </Hydrate>
    </div>
  );
}
