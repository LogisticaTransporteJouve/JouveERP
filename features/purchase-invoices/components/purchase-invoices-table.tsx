"use client";

import { NotJouveBadge } from "@/components/not-jouve-badge";
import { formatCuit } from "@/lib/validation/cuit";
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
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePageChannelScope,
  useScope,
} from "@/components/providers/scope-provider";
import { scopedHref } from "@/lib/scope";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useListParams } from "@/hooks/use-list-params";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";
import { cn } from "@/lib/utils";

import { RecategorizeExpenseButton } from "@/features/cost-centers/components/recategorize-expense-dialog";

import { usePurchaseInvoicesSearchInfinite } from "../hooks/use-purchase-invoices";
import { type PurchaseInvoicesFilters } from "../lib/purchase-invoices-keys";
import {
  DEFAULT_PURCHASE_LIST_PARAMS,
  purchaseListFilters,
  purchaseListParamsToUrl,
  type PurchaseListParams,
} from "../lib/purchase-list-filters";
import {
  purchaseKindLabel,
  PURCHASE_INVOICE_STATUSES,
  PURCHASE_INVOICE_STATUS_LABEL,
  formatInvoiceNumber,
  isPurchaseInvoiceStatus,
  type PurchaseInvoice,
} from "../schema";
import { CancelPurchaseInvoiceDialog } from "./cancel-purchase-invoice-dialog";
import { EditPurchaseInvoiceDialog } from "./edit-purchase-invoice-dialog";
import { NewPurchaseInvoiceDialog } from "./new-purchase-invoice-dialog";

type ChannelLookup = Record<
  string,
  { is_fiscal: boolean; name: string } | undefined
>;

function usePurchaseInvoiceColumns({
  canWrite,
  canCancel,
  channelsById,
  channelId,
}: {
  canWrite: boolean;
  canCancel: boolean;
  channelsById: ChannelLookup;
  /** Inside a segregated channel's section, details open in it. */
  channelId: string | null;
}): ColumnDef<PurchaseInvoice>[] {
  return useMemo<ColumnDef<PurchaseInvoice>[]>(
    () => [
      {
        accessorKey: "numero",
        header: "Comprobante",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <div
              className={cn(
                "font-mono text-xs",
                inv.status === "cancelled" && "opacity-60",
              )}
            >
              <div className="font-medium">
                {purchaseKindLabel(
                  inv.kind,
                  channelsById[inv.channel_id]?.is_fiscal === false,
                )}
              </div>
              <div className="text-muted-foreground">
                {formatInvoiceNumber(inv)}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "supplier_legal_name",
        header: "Proveedor",
        enableSorting: false,
        // Long legal names wrap so the other columns stay in view.
        meta: {
          mobile: "primary",
          cellClassName: "min-w-48 whitespace-normal",
        },
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <div className={cn(inv.status === "cancelled" && "opacity-60")}>
              <Link
                href={`/suppliers/${inv.supplier_id}`}
                className="font-medium hover:underline"
              >
                {inv.supplier_legal_name}
              </Link>
              {inv.is_operational === false && (
                <NotJouveBadge className="ml-1" />
              )}
              {inv.supplier_cuit && (
                <div className="font-mono text-xs text-muted-foreground">
                  CUIT {formatCuit(inv.supplier_cuit)}
                </div>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "channel_id",
        header: "Tipo",
        enableSorting: false,
        meta: { headerClassName: "w-20", mobile: "secondary" },
        cell: ({ row }) => {
          const inv = row.original;
          const dimmed = inv.status === "cancelled" ? "opacity-60" : undefined;
          const channel = channelsById[inv.channel_id];
          // An unread channel (the layout's read failed) is neither side.
          if (!channel) {
            return <span className="text-sm text-muted-foreground">—</span>;
          }
          return channel.is_fiscal === false ? (
            <Badge variant="outline" className={cn("text-xs", dimmed)}>
              Interno
            </Badge>
          ) : (
            <Badge variant="secondary" className={cn("text-xs", dimmed)}>
              Fiscal
            </Badge>
          );
        },
      },
      {
        accessorKey: "fecha",
        header: "Fecha",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <span
            className={cn(
              "text-sm text-muted-foreground",
              row.original.status === "cancelled" && "opacity-60",
            )}
          >
            {formatArgentineDate(row.original.fecha)}
          </span>
        ),
      },
      {
        accessorKey: "imp_total",
        header: "Total",
        enableSorting: false,
        meta: { align: "right", cellClassName: "font-mono", mobile: "primary" },
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <span className={cn(inv.status === "cancelled" && "opacity-60")}>
              {inv.moneda === "PES" ? "$" : "US$"}
              {formatNumber2(inv.imp_total)}
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Estado",
        enableSorting: false,
        meta: { mobile: "primary" },
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <Badge
              variant="secondary"
              className={
                inv.status === "cancelled"
                  ? "bg-muted text-muted-foreground opacity-60 dark:text-muted-foreground"
                  : "bg-muted text-muted-foreground dark:text-muted-foreground"
              }
            >
              {PURCHASE_INVOICE_STATUS_LABEL[inv.status]}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: { align: "right", headerClassName: "w-32", mobile: "primary" },
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <div
              className={cn(
                "flex items-center justify-end gap-1",
                inv.status === "cancelled" && "opacity-60",
              )}
            >
              <IconButton label="Ver detalle" asChild variant="ghost">
                <Link href={scopedHref(`/purchases/${inv.id}`, channelId)}>
                  <Eye className="size-4" />
                </Link>
              </IconButton>
              {canWrite && inv.status === "received" && (
                <EditPurchaseInvoiceDialog invoice={inv} />
              )}
              {canWrite && inv.status === "received" && (
                <RecategorizeExpenseButton
                  expense={{
                    source: "purchase_invoices",
                    id: inv.id,
                    label: `${formatInvoiceNumber(inv)} · ${inv.supplier_legal_name}`,
                    expense_account_id: inv.account_id,
                    cost_center_id: inv.cost_center_id,
                  }}
                />
              )}
              {canCancel && inv.status === "received" && (
                <CancelPurchaseInvoiceDialog invoice={inv} />
              )}
            </div>
          );
        },
      },
    ],
    [canWrite, canCancel, channelsById, channelId],
  );
}

export function PurchaseInvoicesTable({
  actorAccess,
  initialParams,
}: {
  actorAccess: Access;
  initialParams: PurchaseListParams;
}) {
  const { params, committed, update, reset, isFiltered } = useListParams({
    initial: initialParams,
    defaults: DEFAULT_PURCHASE_LIST_PARAMS,
    toUrl: purchaseListParamsToUrl,
  });
  const scope = usePageChannelScope();
  const filters = useMemo(
    () => purchaseListFilters(committed, scope),
    [committed, scope],
  );
  const deferredFilters = useDeferredValue(filters);

  const canWrite = userCan(actorAccess, "purchase_invoices:write");
  const canCancel = userCan(actorAccess, "purchase_invoices:cancel");

  const { allChannels } = useScope();
  const channelsById = Object.fromEntries(allChannels.map((c) => [c.id, c]));

  const columns = usePurchaseInvoiceColumns({
    canWrite,
    canCancel,
    channelsById,
    channelId: scope.channelId,
  });

  return (
    <>
      <ListToolbar
        isFiltered={isFiltered}
        onClear={reset}
        actions={
          <>
            <ExportButton resource="purchase-invoices" />
            {canWrite && <NewPurchaseInvoiceDialog />}
          </>
        }
      >
        <ListSearch
          placeholder="Buscar por proveedor, CUIT o número"
          value={params.query}
          onChange={(query) => update({ query })}
        />
        <PeriodFilter
          value={params.period}
          onChange={(period) => update({ period })}
        />
        <Select
          value={params.status ?? "__all"}
          onValueChange={(v) =>
            update({ status: isPurchaseInvoiceStatus(v) ? v : null })
          }
        >
          <SelectTrigger className="w-[180px]" aria-label="Estado">
            <SelectValue placeholder="Cualquier estado" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="__all">Cualquier estado</SelectItem>
            {PURCHASE_INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PURCHASE_INVOICE_STATUS_LABEL[s]}
              </SelectItem>
            ))}
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
            <PurchaseInvoicesRows columns={columns} filters={deferredFilters} />
          </ListPending>
        </Suspense>
      </div>
    </>
  );
}

function PurchaseInvoicesRows({
  columns,
  filters,
}: {
  columns: ColumnDef<PurchaseInvoice>[];
  filters: PurchaseInvoicesFilters;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePurchaseInvoicesSearchInfinite(filters);

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
      getRowId={(inv) => inv.id}
      emptyMessage="No hay facturas que coincidan."
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
