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
import {
  ListGroupHeader,
  ListGroupToggle,
  ListTotalsBar,
} from "@/components/list-totals";
import { PeriodFilter } from "@/components/period-filter";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import {
  buildPdfFilename,
  formatArgentineDate,
  formatNumber2,
} from "@/lib/format";
import { bucketOf, type ListGroup } from "@/lib/list-period";
import { grandTotal, totalsByBucket } from "@/lib/list-totals";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import {
  ClientFilter,
  type ClientFilterValue,
} from "@/features/clients/components/client-filter";

import type { InvoiceListItem } from "../actions/invoices-actions";
import {
  useInvoiceListTotals,
  useInvoicesSearchInfinite,
} from "../hooks/use-invoices";
import {
  invoiceListFilters,
  invoiceListParamsToUrl,
  parsePuntoVenta,
  type InvoiceListFilters,
  type InvoiceListParams,
} from "../lib/invoice-list-filters";
import { invoicesKeys } from "../lib/invoices-keys";
import {
  INVOICE_KINDS,
  INVOICE_KIND_LABEL,
  INVOICE_STATUSES,
  INVOICE_STATUS_LABEL,
  LETTERS,
  formatInvoiceNumero,
  isInvoiceKind,
  isInvoiceLetter,
  isInvoiceStatus,
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

const ANY = "__any__";

const TOTALS_NOTE = "Las NC restan; anulados y fallidos no suman.";
const NOUN = ["comprobante", "comprobantes"] as const;

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
  initialParams,
  initialClient,
}: {
  actorAccess: Access;
  channels: ChannelOption[];
  initialParams: InvoiceListParams;
  initialClient: ClientFilterValue | null;
}) {
  const [params, setParams] = useState<InvoiceListParams>(initialParams);
  const [client, setClient] = useState<ClientFilterValue | null>(initialClient);
  const [queryInput, setQueryInput] = useState(initialParams.query);
  const [pvInput, setPvInput] = useState(
    initialParams.puntoVenta === null ? "" : String(initialParams.puntoVenta),
  );

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const debouncedPv = useDebouncedValue(pvInput.trim(), 250);
  const setUrlFilters = useUrlFilter();

  const isFiscal = useScopeIsFiscal();
  const current = useMemo<InvoiceListParams>(
    () => ({
      ...params,
      query: debouncedQuery,
      puntoVenta: parsePuntoVenta(debouncedPv),
      clientId: client?.id ?? null,
    }),
    [params, debouncedQuery, debouncedPv, client],
  );
  const filters = useDeferredValue(
    useMemo(() => invoiceListFilters(current, isFiscal), [current, isFiscal]),
  );
  const group = useDeferredValue(current.group);

  const canIssue = userCan(actorAccess, "invoices:issue");
  const canSendEmail = userCan(actorAccess, "email:send");

  // Realtime: any change to comprobantes invalidates the list (every
  // filter combo), its totals and the aging summary (since unpaid invoices
  // drive it).
  useRealtimeInvalidate([
    {
      table: "invoices",
      queryKeys: [invoicesKeys.all, agingKeys.all],
    },
  ]);

  useEffect(() => {
    setUrlFilters(invoiceListParamsToUrl(current));
  }, [current, setUrlFilters]);

  function update(patch: Partial<InvoiceListParams>) {
    setParams((prev) => ({ ...prev, ...patch }));
  }

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setQueryInput(event.target.value);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por cliente o número"
          value={queryInput}
          onChange={onSearchChange}
          className="w-full sm:max-w-xs"
        />
        <PeriodFilter
          value={params.period}
          onChange={(period) => update({ period })}
        />
        <ClientFilter value={client} onChange={setClient} />

        <div className="ml-auto flex items-center gap-2">
          <ExportButton resource="invoices" />
          {canIssue && <NewInvoiceDialog channels={channels} />}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Select
          value={params.kind ?? ANY}
          onValueChange={(v) => update({ kind: isInvoiceKind(v) ? v : null })}
        >
          <SelectTrigger className="w-[170px]" aria-label="Tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY}>Todos los tipos</SelectItem>
            {INVOICE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {INVOICE_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.letter ?? ANY}
          onValueChange={(v) =>
            update({ letter: isInvoiceLetter(v) ? v : null })
          }
        >
          <SelectTrigger className="w-[160px]" aria-label="Letra">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY}>Todas las letras</SelectItem>
            {LETTERS.map((l) => (
              <SelectItem key={l} value={l}>
                Letra {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          inputMode="numeric"
          placeholder="Punto de venta"
          aria-label="Punto de venta"
          value={pvInput}
          onChange={(e) => setPvInput(e.target.value.replace(/\D/g, ""))}
          maxLength={5}
          className="w-[140px]"
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

        <div className="ml-auto">
          <ListGroupToggle
            value={params.group}
            onChange={(next) => update({ group: next })}
          />
        </div>
      </div>

      <div className="mt-4">
        <Suspense fallback={<ComprobantesTableSkeleton />}>
          <ComprobantesTableRows
            filters={filters}
            group={group}
            canSendEmail={canSendEmail}
          />
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
  const total = useMemo(() => grandTotal(totalRows), [totalRows]);
  const byBucket = useMemo(() => totalsByBucket(totalRows), [totalRows]);

  return (
    <div className="space-y-3">
      <ListTotalsBar summary={total} noun={NOUN} note={TOTALS_NOTE} />
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
    </div>
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
