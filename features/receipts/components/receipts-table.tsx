"use client";

import { Download, Eye } from "lucide-react";
import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ListGroupHeader,
  ListGroupToggle,
  ListTotalsBar,
} from "@/components/list-totals";
import { PeriodFilter } from "@/components/period-filter";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { SendByEmailDialog } from "@/components/send-by-email-dialog";
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
import { PdfViewerDialog } from "@/features/invoices/components/pdf-viewer-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { bucketOf, type ListGroup } from "@/lib/list-period";
import { grandTotal, totalsByBucket } from "@/lib/list-totals";

import type { Account } from "@/features/accounts/schema";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { agingKeys } from "@/features/aging/lib/aging-keys";
import {
  ClientFilter,
  type ClientFilterValue,
} from "@/features/clients/components/client-filter";

import {
  useReceiptListTotals,
  useReceiptsSearchInfinite,
} from "../hooks/use-receipts";
import {
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
const TOTALS_NOTE = "Los anulados no suman.";

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

export function ReceiptsTable({
  channels,
  actorAccess,
  initialParams,
  initialClient,
}: {
  channels: ChannelOption[];
  actorAccess: Access;
  initialParams: ReceiptListParams;
  initialClient: ClientFilterValue | null;
}) {
  const { data: accounts } = useAccountsList();
  const canWrite = userCan(actorAccess, "receipts:write");
  const canSendEmail = userCan(actorAccess, "email:send");

  const [params, setParams] = useState<ReceiptListParams>(initialParams);
  const [client, setClient] = useState<ClientFilterValue | null>(initialClient);
  const [queryInput, setQueryInput] = useState(initialParams.query);
  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const setUrlFilters = useUrlFilter();
  const isFiscal = useScopeIsFiscal();

  const current = useMemo<ReceiptListParams>(
    () => ({ ...params, query: debouncedQuery, clientId: client?.id ?? null }),
    [params, debouncedQuery, client],
  );
  const filters = useDeferredValue(
    useMemo(() => receiptListFilters(current, isFiscal), [current, isFiscal]),
  );
  const group = useDeferredValue(current.group);

  // Realtime: invalidate the list, its totals (and aging, since allocations
  // live on the parent's updated_at) whenever any receipt changes server-side.
  useRealtimeInvalidate([
    {
      table: "receipts",
      queryKeys: [receiptsKeys.all, agingKeys.all],
    },
  ]);

  useEffect(() => {
    setUrlFilters(receiptListParamsToUrl(current));
  }, [current, setUrlFilters]);

  function update(patch: Partial<ReceiptListParams>) {
    setParams((prev) => ({ ...prev, ...patch }));
  }

  const columns = useMemo(
    () => buildReceiptColumns({ channels, accounts, canWrite, canSendEmail }),
    [channels, accounts, canWrite, canSendEmail],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          inputMode="numeric"
          placeholder="Buscar por número"
          aria-label="Buscar por número"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value.replace(/\D/g, ""))}
          className="w-full sm:max-w-[200px]"
        />
        <PeriodFilter
          value={params.period}
          onChange={(period) => update({ period })}
        />
        <ClientFilter value={client} onChange={setClient} />
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

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <ListGroupToggle
            value={params.group}
            onChange={(next) => update({ group: next })}
          />
          {canWrite && (
            <NewReceiptDialog channels={channels} accounts={accounts} />
          )}
        </div>
      </div>

      <div className="mt-4">
        <Suspense
          fallback={
            <DataTable columns={columns} data={[]} isLoading skeletonRows={6} />
          }
        >
          <ReceiptsTableRows
            filters={filters}
            group={group}
            columns={columns}
          />
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

  const total = useMemo(() => grandTotal(totalRows), [totalRows]);
  const byBucket = useMemo(() => totalsByBucket(totalRows), [totalRows]);

  return (
    <div className="space-y-3">
      <ListTotalsBar summary={total} noun={NOUN} note={TOTALS_NOTE} />
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
    </div>
  );
}
