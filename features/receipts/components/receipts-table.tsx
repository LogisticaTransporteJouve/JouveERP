"use client";

import { Download, Eye } from "lucide-react";
import Link from "next/link";
import { Suspense, useDeferredValue, useMemo } from "react";

import { ExportButton } from "@/components/export-button";
import { ListGroupHeader, ListGroupToggle } from "@/components/list-totals";
import {
  ListPending,
  ListSearch,
  ListToolbar,
} from "@/components/list-toolbar";
import { PeriodFilter } from "@/components/period-filter";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { SendByEmailDialog } from "@/components/send-by-email-dialog";
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
import { PdfViewerDialog } from "@/features/invoices/components/pdf-viewer-dialog";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useListParams } from "@/hooks/use-list-params";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { bucketOf, type ListGroup } from "@/lib/list-period";
import { totalsByBucket } from "@/lib/list-totals";

import type { Account } from "@/features/accounts/schema";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { agingKeys } from "@/features/aging/lib/aging-keys";

import {
  useReceiptListTotals,
  useReceiptsSearchInfinite,
} from "../hooks/use-receipts";
import {
  DEFAULT_RECEIPT_LIST_PARAMS,
  receiptListFilters,
  receiptListParamsToUrl,
  type ReceiptListFilters,
  type ReceiptListParams,
} from "../lib/receipt-list-filters";
import { receiptsKeys } from "../lib/receipts-keys";
import { formatReceiptNumber, isReceiptStatus, type Receipt } from "../schema";
import { CancelReceiptDialog } from "./cancel-receipt-dialog";
import { EditReceiptDialog } from "./edit-receipt-dialog";
import { NewReceiptDialog } from "./new-receipt-dialog";
import type { ChannelOption } from "./receipt-form";

type ReceiptListItem = Receipt & { client_legal_name: string };

const ANY = "__any__";
const NOUN = ["recibo", "recibos"] as const;

function buildReceiptColumns({
  channels,
  accounts,
  canWrite,
  canSendEmail,
}: {
  channels: ChannelOption[];
  accounts: Account[];
  canWrite: boolean;
  canSendEmail: boolean;
}): ColumnDef<ReceiptListItem>[] {
  return [
    {
      id: "numero",
      header: "Recibo",
      enableSorting: false,
      meta: { cellClassName: "font-mono text-sm" },
      cell: ({ row }) => (
        <span
          className={
            row.original.status === "canceled" ? "line-through" : undefined
          }
        >
          {formatReceiptNumber(row.original.punto_venta, row.original.numero)}
        </span>
      ),
    },
    {
      id: "cliente",
      header: "Cliente",
      enableSorting: false,
      // Long legal names wrap so the other columns stay in view.
      meta: { cellClassName: "min-w-48 whitespace-normal" },
      cell: ({ row }) => (
        <Link
          href={`/clients/${row.original.client_id}`}
          className="hover:underline"
        >
          {row.original.client_legal_name}
        </Link>
      ),
    },
    {
      id: "fecha",
      header: "Fecha",
      enableSorting: false,
      meta: { cellClassName: "text-sm text-muted-foreground" },
      cell: ({ row }) => formatArgentineDate(row.original.receipt_date),
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
          <Badge variant="destructive">Anulado</Badge>
        ) : (
          <Badge
            variant="secondary"
            className="bg-muted text-muted-foreground dark:text-muted-foreground"
          >
            Emitido
          </Badge>
        ),
    },
    {
      id: "acciones",
      header: "Acciones",
      enableSorting: false,
      meta: { align: "right", headerClassName: "w-28" },
      cell: ({ row }) => {
        const r = row.original;
        const isCanceled = r.status === "canceled";
        const numero = formatReceiptNumber(r.punto_venta, r.numero);
        return (
          <div className="flex items-center justify-end gap-1">
            <Button asChild variant="ghost" size="icon" aria-label="Ver recibo">
              <Link href={`/receipts/${r.id}`}>
                <Eye className="size-4" />
              </Link>
            </Button>
            <PdfViewerDialog id={r.id} label={numero} kind="receipt" />
            <Button
              asChild
              variant="ghost"
              size="icon"
              aria-label="Descargar PDF"
            >
              <Link href={`/api/receipts/${r.id}/pdf`}>
                <Download className="size-4" />
              </Link>
            </Button>
            {canSendEmail && !isCanceled && (
              <SendByEmailDialog kind="receipt" id={r.id} />
            )}
            {canWrite && !isCanceled && (
              <EditReceiptDialog
                receiptId={r.id}
                numero={r.numero}
                puntoVenta={r.punto_venta}
                channels={channels}
                accounts={accounts}
              />
            )}
            {canWrite && !isCanceled && (
              <CancelReceiptDialog
                receiptId={r.id}
                numero={r.numero}
                puntoVenta={r.punto_venta}
              />
            )}
          </div>
        );
      },
    },
  ];
}

const VIEW_KEYS = ["group"] as const;

export function ReceiptsTable({
  channels,
  actorAccess,
  initialParams,
}: {
  channels: ChannelOption[];
  actorAccess: Access;
  initialParams: ReceiptListParams;
}) {
  const { data: accounts } = useAccountsList();
  const canWrite = userCan(actorAccess, "receipts:write");
  const canSendEmail = userCan(actorAccess, "email:send");

  const { params, committed, update, reset, isFiltered } = useListParams({
    initial: initialParams,
    defaults: DEFAULT_RECEIPT_LIST_PARAMS,
    toUrl: receiptListParamsToUrl,
    viewKeys: VIEW_KEYS,
  });
  const isFiscal = useScopeIsFiscal();
  const filters = useMemo(
    () => receiptListFilters(committed, isFiscal),
    [committed, isFiscal],
  );
  const deferredFilters = useDeferredValue(filters);
  const group = useDeferredValue(committed.group);
  const pending = deferredFilters !== filters || group !== committed.group;

  // Realtime: invalidate the list, its subtotals (and aging, since
  // allocations live on the parent's updated_at) whenever any receipt
  // changes server-side.
  useRealtimeInvalidate([
    {
      table: "receipts",
      queryKeys: [receiptsKeys.all, agingKeys.all],
    },
  ]);

  const columns = useMemo(
    () => buildReceiptColumns({ channels, accounts, canWrite, canSendEmail }),
    [channels, accounts, canWrite, canSendEmail],
  );

  return (
    <>
      <ListToolbar
        isFiltered={isFiltered}
        onClear={reset}
        actions={
          <>
            <ListGroupToggle
              value={params.group}
              onChange={(next) => update({ group: next })}
            />
            <ExportButton resource="receipts" />
            {canWrite && (
              <NewReceiptDialog channels={channels} accounts={accounts} />
            )}
          </>
        }
      >
        <ListSearch
          placeholder="Buscar por cliente o número"
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
            update({ status: isReceiptStatus(v) ? v : null })
          }
        >
          <SelectTrigger className="w-[170px]" aria-label="Estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY}>Cualquier estado</SelectItem>
            <SelectItem value="issued">Emitido</SelectItem>
            <SelectItem value="canceled">Anulado</SelectItem>
          </SelectContent>
        </Select>
      </ListToolbar>

      <div className="mt-4">
        <Suspense
          fallback={
            <DataTable columns={columns} data={[]} isLoading skeletonRows={6} />
          }
        >
          <ListPending pending={pending}>
            <ReceiptsTableRows
              filters={deferredFilters}
              group={group}
              columns={columns}
            />
          </ListPending>
        </Suspense>
      </div>
    </>
  );
}

function ReceiptsTableRows({
  filters,
  group,
  columns,
}: {
  filters: ReceiptListFilters;
  group: ListGroup | null;
  columns: ColumnDef<ReceiptListItem>[];
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useReceiptsSearchInfinite(filters);
  const { data: totalRows } = useReceiptListTotals(filters, group);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  const byBucket = useMemo(() => totalsByBucket(totalRows ?? []), [totalRows]);

  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(row) => row.id}
      emptyMessage="No hay recibos que coincidan."
      groupBy={
        group
          ? {
              key: (row) => bucketOf(row.receipt_date, group),
              header: (bucket) => (
                <ListGroupHeader
                  bucket={bucket}
                  group={group}
                  summary={byBucket.get(bucket)}
                  noun={NOUN}
                />
              ),
            }
          : undefined
      }
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
