"use client";

import { Eye } from "lucide-react";
import Link from "next/link";
import { Suspense, useDeferredValue, useMemo } from "react";

import { ExportButton } from "@/components/export-button";
import {
  ListPending,
  ListSearch,
  ListToolbar,
} from "@/components/list-toolbar";
import { PeriodFilter } from "@/components/period-filter";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useListParams } from "@/hooks/use-list-params";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import type { Account } from "@/features/accounts/schema";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import { usePaymentOrdersSearchInfinite } from "../hooks/use-payment-orders";
import {
  DEFAULT_PAYMENT_ORDER_LIST_PARAMS,
  paymentOrderListFilters,
  paymentOrderListParamsToUrl,
  type PaymentOrderListFilters,
  type PaymentOrderListParams,
} from "../lib/payment-order-list-filters";
import { paymentOrdersKeys } from "../lib/payment-orders-keys";
import {
  formatPaymentOrderNumber,
  isPaymentOrderStatus,
  type PaymentOrder,
} from "../schema";
import { CancelPaymentOrderDialog } from "./cancel-payment-order-dialog";
import { EditPaymentOrderDialog } from "./edit-payment-order-dialog";
import { NewPaymentOrderDialog } from "./new-payment-order-dialog";
import type { ChannelOption } from "./payment-order-form";

type PaymentOrderListItem = PaymentOrder & { supplier_legal_name: string };

const ANY = "__any__";

function buildPaymentOrderColumns({
  channels,
  accounts,
  canWrite,
}: {
  channels: ChannelOption[];
  accounts: Account[];
  canWrite: boolean;
}): ColumnDef<PaymentOrderListItem>[] {
  return [
    {
      id: "numero",
      header: "OP",
      enableSorting: false,
      meta: { cellClassName: "font-mono text-sm" },
      cell: ({ row }) => (
        <span
          className={
            row.original.status === "canceled" ? "line-through" : undefined
          }
        >
          {formatPaymentOrderNumber(
            row.original.punto_venta,
            row.original.numero,
          )}
        </span>
      ),
    },
    {
      id: "proveedor",
      header: "Proveedor",
      enableSorting: false,
      // Long legal names wrap so the other columns stay in view.
      meta: { cellClassName: "min-w-48 whitespace-normal" },
      cell: ({ row }) => (
        <Link
          href={`/suppliers/${row.original.supplier_id}`}
          className="hover:underline"
        >
          {row.original.supplier_legal_name}
        </Link>
      ),
    },
    {
      id: "fecha",
      header: "Fecha",
      enableSorting: false,
      meta: { cellClassName: "text-sm text-muted-foreground" },
      cell: ({ row }) => formatArgentineDate(row.original.payment_date),
    },
    {
      id: "total",
      header: "Total",
      enableSorting: false,
      meta: { align: "right", cellClassName: "font-mono text-sm" },
      cell: ({ row }) =>
        formatMoney(Number(row.original.total_amount), row.original.currency),
    },
    {
      id: "estado",
      header: "Estado",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status === "canceled" ? (
          <Badge variant="destructive">Anulada</Badge>
        ) : (
          <Badge
            variant="secondary"
            className="bg-muted text-muted-foreground dark:text-muted-foreground"
          >
            Emitida
          </Badge>
        ),
    },
    {
      id: "acciones",
      header: "Acciones",
      enableSorting: false,
      meta: { align: "right", headerClassName: "w-28" },
      cell: ({ row }) => {
        const op = row.original;
        const isCanceled = op.status === "canceled";
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              asChild
              variant="ghost"
              size="icon"
              aria-label="Ver detalle"
            >
              <Link href={`/payment-orders/${op.id}`}>
                <Eye className="size-4" />
              </Link>
            </Button>
            {canWrite && !isCanceled && (
              <EditPaymentOrderDialog
                paymentOrderId={op.id}
                numero={op.numero}
                puntoVenta={op.punto_venta}
                channels={channels}
                accounts={accounts}
              />
            )}
            {canWrite && !isCanceled && (
              <CancelPaymentOrderDialog
                paymentOrderId={op.id}
                numero={op.numero}
                puntoVenta={op.punto_venta}
              />
            )}
          </div>
        );
      },
    },
  ];
}

export function PaymentOrdersTable({
  channels,
  actorAccess,
  initialParams,
}: {
  channels: ChannelOption[];
  actorAccess: Access;
  initialParams: PaymentOrderListParams;
}) {
  const { data: accounts } = useAccountsList();
  const canWrite = userCan(actorAccess, "payment_orders:write");

  const { params, committed, update, reset, isFiltered } = useListParams({
    initial: initialParams,
    defaults: DEFAULT_PAYMENT_ORDER_LIST_PARAMS,
    toUrl: paymentOrderListParamsToUrl,
  });
  const isFiscal = useScopeIsFiscal();
  const filters = useMemo(
    () => paymentOrderListFilters(committed, isFiscal),
    [committed, isFiscal],
  );
  const deferredFilters = useDeferredValue(filters);

  useRealtimeInvalidate([
    {
      table: "payment_orders",
      queryKeys: [paymentOrdersKeys.all],
    },
  ]);

  const columns = useMemo(
    () => buildPaymentOrderColumns({ channels, accounts, canWrite }),
    [channels, accounts, canWrite],
  );

  return (
    <>
      <ListToolbar
        isFiltered={isFiltered}
        onClear={reset}
        actions={
          <>
            <ExportButton resource="payment-orders" />
            {canWrite && (
              <NewPaymentOrderDialog channels={channels} accounts={accounts} />
            )}
          </>
        }
      >
        <ListSearch
          placeholder="Buscar por proveedor o número"
          value={params.query}
          onChange={(query) => update({ query })}
        />
        <PeriodFilter
          value={params.period}
          onChange={(period) => update({ period })}
        />
        <Select
          value={params.status ?? ANY}
          onValueChange={(v) =>
            update({ status: isPaymentOrderStatus(v) ? v : null })
          }
        >
          <SelectTrigger className="w-[170px]" aria-label="Estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY}>Cualquier estado</SelectItem>
            <SelectItem value="issued">Emitida</SelectItem>
            <SelectItem value="canceled">Anulada</SelectItem>
          </SelectContent>
        </Select>
      </ListToolbar>

      <div className="mt-4">
        <Suspense
          fallback={
            <DataTable columns={columns} data={[]} isLoading skeletonRows={6} />
          }
        >
          <ListPending pending={deferredFilters !== filters}>
            <PaymentOrdersRows filters={deferredFilters} columns={columns} />
          </ListPending>
        </Suspense>
      </div>
    </>
  );
}

function PaymentOrdersRows({
  filters,
  columns,
}: {
  filters: PaymentOrderListFilters;
  columns: ColumnDef<PaymentOrderListItem>[];
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePaymentOrdersSearchInfinite(filters);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(row) => row.id}
      emptyMessage="No hay órdenes de pago que coincidan."
      footer={
        hasNextPage ? (
          <div
            ref={sentinelRef}
            className="py-4 text-center text-xs text-muted-foreground"
          >
            Cargando más…
          </div>
        ) : null
      }
    />
  );
}
