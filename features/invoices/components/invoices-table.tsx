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
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useListParams } from "@/hooks/use-list-params";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import {
  buildPdfFilename,
  formatArgentineDate,
  formatNumber2,
} from "@/lib/format";
import { bucketOf, type ListGroup } from "@/lib/list-period";
import { totalsByBucket } from "@/lib/list-totals";

import { agingKeys } from "@/features/aging/lib/aging-keys";

import type { InvoiceListItem } from "../actions/invoices-actions";
import {
  useInvoiceListTotals,
  useInvoicesSearchInfinite,
} from "../hooks/use-invoices";
import {
  DEFAULT_INVOICE_LIST_PARAMS,
  invoiceListFilters,
  invoiceListParamsToUrl,
  type InvoiceListFilters,
  type InvoiceListParams,
} from "../lib/invoice-list-filters";
import { invoicesKeys } from "../lib/invoices-keys";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABEL,
  formatInvoiceNumero,
  isInvoiceStatus,
  type InvoiceStatus,
} from "../schema";
import { InvoiceTypeFilter } from "./invoice-type-filter";
import { NewInvoiceDialog } from "./new-invoice-dialog";
import { PdfViewerDialog } from "./pdf-viewer-dialog";

function formatPdfFilename(row: InvoiceListItem): string {
  const numero = formatInvoiceNumero(
    row.kind,
    row.letter,
    row.punto_venta,
    row.numero,
  );
  return buildPdfFilename(numero, row.client_legal_name);
}

const ANY = "__any__";

const NOUN = ["comprobante", "comprobantes"] as const;

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground dark:text-muted-foreground",
  emitting: "bg-muted text-muted-foreground dark:text-muted-foreground",
  emitted: "bg-muted text-muted-foreground dark:text-muted-foreground",
  failed: "bg-muted text-foreground dark:text-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

interface ChannelOption {
  id: string;
  name: string;
  is_fiscal: boolean;
}

function buildInvoiceColumns(
  canSendEmail: boolean,
): ColumnDef<InvoiceListItem>[] {
  return [
    {
      id: "numero",
      header: "Número",
      enableSorting: false,
      meta: { cellClassName: "font-mono text-xs" },
      cell: ({ row }) =>
        formatInvoiceNumero(
          row.original.kind,
          row.original.letter,
          row.original.punto_venta,
          row.original.numero,
        ),
    },
    {
      id: "cliente",
      header: "Cliente",
      enableSorting: false,
      // Long legal names wrap so the other columns stay in view.
      meta: { cellClassName: "min-w-48 font-medium whitespace-normal" },
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
      cell: ({ row }) => formatArgentineDate(row.original.fecha),
    },
    {
      id: "total",
      header: "Total",
      enableSorting: false,
      meta: { align: "right", cellClassName: "font-mono" },
      cell: ({ row }) => `$${formatNumber2(row.original.imp_total)}`,
    },
    {
      id: "estado",
      header: "Estado",
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="secondary" className={STATUS_TONE[row.original.status]}>
          {INVOICE_STATUS_LABEL[row.original.status]}
        </Badge>
      ),
    },
    {
      id: "acciones",
      header: "Acciones",
      enableSorting: false,
      meta: { align: "right", headerClassName: "w-32" },
      cell: ({ row }) => {
        const invoice = row.original;
        const hasPdf = invoice.status === "emitted";
        const numero = formatInvoiceNumero(
          invoice.kind,
          invoice.letter,
          invoice.punto_venta,
          invoice.numero,
        );
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              asChild
              variant="ghost"
              size="icon"
              aria-label="Ver detalle"
            >
              <Link href={`/invoices/${invoice.id}`}>
                <Eye className="size-4" />
              </Link>
            </Button>
            {hasPdf && (
              <>
                <PdfViewerDialog id={invoice.id} label={numero} />
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label="Descargar PDF"
                >
                  <a
                    href={`/api/invoices/${invoice.id}/pdf`}
                    download={formatPdfFilename(invoice)}
                  >
                    <Download className="size-4" />
                  </a>
                </Button>
                {canSendEmail && (
                  <SendByEmailDialog kind="invoice" id={invoice.id} />
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];
}

const VIEW_KEYS = ["group"] as const;

export function ComprobantesTable({
  actorAccess,
  channels,
  initialParams,
}: {
  actorAccess: Access;
  channels: ChannelOption[];
  initialParams: InvoiceListParams;
}) {
  const { params, committed, update, reset, isFiltered } = useListParams({
    initial: initialParams,
    defaults: DEFAULT_INVOICE_LIST_PARAMS,
    toUrl: invoiceListParamsToUrl,
    viewKeys: VIEW_KEYS,
  });

  const isFiscal = useScopeIsFiscal();
  const filters = useMemo(
    () => invoiceListFilters(committed, isFiscal),
    [committed, isFiscal],
  );
  const deferredFilters = useDeferredValue(filters);
  const group = useDeferredValue(committed.group);
  const pending = deferredFilters !== filters || group !== committed.group;

  const canIssue = userCan(actorAccess, "invoices:issue");
  const canSendEmail = userCan(actorAccess, "email:send");

  // Realtime: any change to comprobantes invalidates the list (every
  // filter combo), its subtotals and the aging summary (since unpaid
  // invoices drive it).
  useRealtimeInvalidate([
    {
      table: "invoices",
      queryKeys: [invoicesKeys.all, agingKeys.all],
    },
  ]);

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
            <ExportButton resource="invoices" />
            {canIssue && <NewInvoiceDialog channels={channels} />}
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
        <InvoiceTypeFilter
          value={params.types}
          onChange={(types) => update({ types })}
        />
        <Select
          value={params.status ?? ANY}
          onValueChange={(v) =>
            update({ status: isInvoiceStatus(v) ? v : null })
          }
        >
          <SelectTrigger className="w-[170px]" aria-label="Estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY}>Cualquier estado</SelectItem>
            {INVOICE_STATUSES.map((st) => (
              <SelectItem key={st} value={st}>
                {INVOICE_STATUS_LABEL[st]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ListToolbar>

      <div className="mt-4">
        <Suspense fallback={<ComprobantesTableSkeleton />}>
          <ListPending pending={pending}>
            <ComprobantesTableRows
              filters={deferredFilters}
              group={group}
              canSendEmail={canSendEmail}
            />
          </ListPending>
        </Suspense>
      </div>
    </>
  );
}

function ComprobantesTableRows({
  filters,
  group,
  canSendEmail,
}: {
  filters: InvoiceListFilters;
  group: ListGroup | null;
  canSendEmail: boolean;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInvoicesSearchInfinite(filters);
  const { data: totalRows } = useInvoiceListTotals(filters, group);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  const columns = useMemo(
    () => buildInvoiceColumns(canSendEmail),
    [canSendEmail],
  );
  const byBucket = useMemo(() => totalsByBucket(totalRows ?? []), [totalRows]);

  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(row) => row.id}
      emptyMessage="No hay comprobantes que coincidan."
      groupBy={
        group
          ? {
              key: (row) => bucketOf(row.fecha, group),
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

function ComprobantesTableSkeleton() {
  return (
    <DataTable
      columns={buildInvoiceColumns(false)}
      data={[]}
      isLoading
      skeletonRows={6}
    />
  );
}
