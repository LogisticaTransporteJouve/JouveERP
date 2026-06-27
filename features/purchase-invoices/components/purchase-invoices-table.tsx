"use client";

import { Eye } from "lucide-react";
import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useScope } from "@/components/providers/scope-provider";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";
import { cn } from "@/lib/utils";

import { usePurchaseInvoicesSearchInfinite } from "../hooks/use-purchase-invoices";
import { type PurchaseInvoicesFilters } from "../lib/purchase-invoices-keys";
import {
  PURCHASE_INVOICE_KIND_LABEL,
  PURCHASE_INVOICE_STATUSES,
  PURCHASE_INVOICE_STATUS_LABEL,
  formatInvoiceNumber,
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
}: {
  canWrite: boolean;
  canCancel: boolean;
  channelsById: ChannelLookup;
}): ColumnDef<PurchaseInvoice>[] {
  return useMemo<ColumnDef<PurchaseInvoice>[]>(
    () => [
      {
        accessorKey: "numero",
        header: "Comprobante",
        enableSorting: false,
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
                {PURCHASE_INVOICE_KIND_LABEL[inv.kind]}
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
              <div className="font-mono text-xs text-muted-foreground">
                CUIT {inv.supplier_cuit}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "channel_id",
        header: "Tipo",
        enableSorting: false,
        meta: { headerClassName: "w-20" },
        cell: ({ row }) => {
          const inv = row.original;
          const dimmed = inv.status === "cancelled" ? "opacity-60" : undefined;
          return channelsById[inv.channel_id]?.is_fiscal === false ? (
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
        meta: { align: "right", cellClassName: "font-mono" },
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
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <Badge
              variant="secondary"
              className={
                inv.status === "cancelled"
                  ? "bg-zinc-500/15 text-zinc-700 opacity-60 dark:text-zinc-300"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
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
        meta: { align: "right", headerClassName: "w-24" },
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <div
              className={cn(
                "flex items-center justify-end gap-1",
                inv.status === "cancelled" && "opacity-60",
              )}
            >
              <Button
                asChild
                variant="ghost"
                size="icon"
                aria-label="Ver detalle"
              >
                <Link href={`/purchases/${inv.id}`}>
                  <Eye className="size-4" />
                </Link>
              </Button>
              {canWrite && inv.status === "received" && (
                <EditPurchaseInvoiceDialog invoice={inv} />
              )}
              {canCancel && inv.status === "received" && (
                <CancelPurchaseInvoiceDialog invoice={inv} />
              )}
            </div>
          );
        },
      },
    ],
    [canWrite, canCancel, channelsById],
  );
}

export function PurchaseInvoicesTable({
  actorRoles,
  initialQuery,
  initialStatus,
  initialFiscalFilter,
}: {
  actorRoles: Role[];
  initialQuery: string;
  initialStatus: string | null;
  initialFiscalFilter?: string | null;
}) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [fiscalFilter, setFiscalFilter] = useState<string>(
    initialFiscalFilter ?? "all",
  );

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorRoles, "purchase_invoices:write");
  const canCancel = userCan(actorRoles, "purchase_invoices:cancel");

  const { channels } = useScope();
  const channelsById = Object.fromEntries(
    channels.map((c) => [c.id, c]),
  );

  useEffect(() => {
    setUrlFilters({
      q: debouncedQuery || null,
      status: status ?? null,
      type: fiscalFilter === "all" ? null : fiscalFilter,
    });
  }, [debouncedQuery, status, fiscalFilter, setUrlFilters]);

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setQueryInput(event.target.value);
  }

  const isFiscalParam =
    fiscalFilter === "fiscal"
      ? true
      : fiscalFilter === "internal"
        ? false
        : null;

  const filters: PurchaseInvoicesFilters = {
    query: debouncedQuery,
    supplierId: null,
    channelId: null,
    status,
    fechaFrom: null,
    fechaTo: null,
    isFiscal: isFiscalParam,
  };
  const deferredFilters = useDeferredValue(filters);

  const columns = usePurchaseInvoiceColumns({
    canWrite,
    canCancel,
    channelsById,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por proveedor, CUIT o número"
          value={queryInput}
          onChange={onSearchChange}
          className="max-w-md"
        />
        <Select
          value={status ?? "__all"}
          onValueChange={(v) => setStatus(v === "__all" ? null : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Cualquier estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Cualquier estado</SelectItem>
            {PURCHASE_INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PURCHASE_INVOICE_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fiscalFilter} onValueChange={setFiscalFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="fiscal">Solo fiscales</SelectItem>
            <SelectItem value="internal">Solo internas</SelectItem>
          </SelectContent>
        </Select>
        {canWrite && (
          <div className="ml-auto">
            <NewPurchaseInvoiceDialog />
          </div>
        )}
      </div>

      <div className="mt-4">
        <Suspense
          fallback={
            <DataTable columns={columns} data={[]} isLoading skeletonRows={6} />
          }
        >
          <PurchaseInvoicesRows columns={columns} filters={deferredFilters} />
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
