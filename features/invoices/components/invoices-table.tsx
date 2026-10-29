"use client";

import { Download, Eye } from "lucide-react";
import Link from "next/link";

import { ExportButton } from "@/components/export-button";
import { SendByEmailDialog } from "@/components/send-by-email-dialog";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import {
  buildPdfFilename,
  formatArgentineDate,
  formatNumber2,
} from "@/lib/format";

import { agingKeys } from "@/features/aging/lib/aging-keys";

import type { InvoiceListItem } from "../actions/invoices-actions";
import { useInvoicesSearchInfinite } from "../hooks/use-invoices";
import { invoicesKeys } from "../lib/invoices-keys";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABEL,
  formatInvoiceNumero,
  type InvoiceStatus,
} from "../schema";
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

const ANY_STATUS = "__any__";
const ANY_CHANNEL = "__any__";

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  emitting: "bg-muted text-muted-foreground dark:text-muted-foreground",
  emitted: "bg-muted text-muted-foreground dark:text-muted-foreground",
  failed: "bg-muted text-foreground dark:text-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

interface ChannelOption {
  id: string;
  name: string;
  division: string;
  is_fiscal: boolean;
}

function buildInvoiceColumns(
  canSendEmail: boolean,
): ColumnDef<InvoiceListItem>[] {
  return [
    {
      id: "numero",
      header: "Factura",
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
      meta: { cellClassName: "font-medium" },
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

export function ComprobantesTable({
  actorAccess,
  channels,
  initialChannel,
  initialStatus,
  initialQuery,
}: {
  actorAccess: Access;
  channels: ChannelOption[];
  initialChannel: string | null;
  initialStatus: InvoiceStatus | null;
  initialQuery: string;
}) {
  const [channelInput, setChannelInput] = useState<string>(
    initialChannel ?? ANY_CHANNEL,
  );
  const [statusInput, setStatusInput] = useState<string>(
    initialStatus ?? ANY_STATUS,
  );
  const [queryInput, setQueryInput] = useState(initialQuery);

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const setUrlFilters = useUrlFilter();

  const channel = channelInput === ANY_CHANNEL ? null : channelInput;
  const status =
    statusInput === ANY_STATUS ? null : (statusInput as InvoiceStatus);

  const deferredChannel = useDeferredValue(channel);
  const deferredStatus = useDeferredValue(status);
  const deferredQuery = useDeferredValue(debouncedQuery);

  const canIssue = userCan(actorAccess, "invoices:issue");
  const canSendEmail = userCan(actorAccess, "email:send");

  // Realtime: any change to comprobantes invalidates the list (every
  // filter combo) and the aging summary (since unpaid invoices drive it).
  useRealtimeInvalidate([
    {
      table: "invoices",
      queryKeys: [invoicesKeys.all, agingKeys.all],
    },
  ]);

  useEffect(() => {
    setUrlFilters({
      channel: channel ?? null,
      status: status ?? null,
      q: debouncedQuery || null,
    });
  }, [channel, status, debouncedQuery, setUrlFilters]);

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setQueryInput(event.target.value);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={channelInput} onValueChange={setChannelInput}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY_CHANNEL}>Todos los canales</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusInput} onValueChange={setStatusInput}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY_STATUS}>Cualquier estado</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {INVOICE_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Buscar por cliente o factura"
          value={queryInput}
          onChange={onSearchChange}
          className="max-w-md flex-1"
        />

        <div className="ml-auto flex items-center gap-2">
          <ExportButton resource="invoices" />
          {canIssue && <NewInvoiceDialog channels={channels} />}
        </div>
      </div>

      <div className="mt-4">
        <Suspense fallback={<ComprobantesTableSkeleton />}>
          <ComprobantesTableRows
            channel={deferredChannel}
            status={deferredStatus}
            query={deferredQuery}
            canSendEmail={canSendEmail}
          />
        </Suspense>
      </div>
    </>
  );
}

function ComprobantesTableRows({
  channel,
  status,
  query,
  canSendEmail,
}: {
  channel: string | null;
  status: InvoiceStatus | null;
  query: string;
  canSendEmail: boolean;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInvoicesSearchInfinite({ channel, status, query });

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

  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(row) => row.id}
      emptyMessage="No hay comprobantes que coincidan."
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
