"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useInfinitePagedQuery } from "@/hooks/use-infinite-paged-query";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import {
  listComprobantesAction,
  type ComprobanteListItem,
} from "../actions/comprobantes-actions";
import {
  COMPROBANTE_KIND_LABEL,
  COMPROBANTE_STATUSES,
  COMPROBANTE_STATUS_LABEL,
  type ComprobanteStatus,
} from "../schema";
import { NewComprobanteDialog } from "./new-comprobante-dialog";

const PAGE_SIZE = 50;
const ANY_STATUS = "__any__";
const ANY_CHANNEL = "__any__";

const STATUS_TONE: Record<ComprobanteStatus, string> = {
  draft: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  emitting: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  emitted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};

interface ChannelOption {
  id: string;
  name: string;
  division: string;
}

async function fetchPage(
  channel: string | null,
  status: ComprobanteStatus | null,
  query: string,
  offset: number,
): Promise<{ items: ComprobanteListItem[]; nextOffset: number | null }> {
  const result = await listComprobantesAction({
    channel_id: channel,
    status,
    query: query.length > 0 ? query : null,
    offset,
    limit: PAGE_SIZE,
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function ComprobantesTable({
  actorRoles,
  channels,
  initialChannel,
  initialStatus,
  initialQuery,
}: {
  actorRoles: Role[];
  channels: ChannelOption[];
  initialChannel: string | null;
  initialStatus: ComprobanteStatus | null;
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
    statusInput === ANY_STATUS ? null : (statusInput as ComprobanteStatus);

  const canIssue = userCan(actorRoles, "invoices:issue");

  const {
    items,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useInfinitePagedQuery<ComprobanteListItem>({
    queryKey: [
      "comprobantes",
      { channel, status, query: debouncedQuery },
    ],
    queryFn: (offset) => fetchPage(channel, status, debouncedQuery, offset),
  });

  // Sync URL with applied filters so the page is shareable.
  useEffect(() => {
    setUrlFilters({
      channel: channel ?? null,
      status: status ?? null,
      q: debouncedQuery || null,
    });
  }, [channel, status, debouncedQuery, setUrlFilters]);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

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
            {COMPROBANTE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {COMPROBANTE_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Buscar por cliente o número"
          value={queryInput}
          onChange={onSearchChange}
          className="max-w-md flex-1"
        />

        {canIssue && (
          <div className="ml-auto">
            <NewComprobanteDialog channels={channels} />
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Número</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Cargando…
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-destructive"
                >
                  {error instanceof Error ? error.message : "Error al cargar."}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void refetch()}
                  >
                    Reintentar
                  </button>
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay comprobantes que coincidan.
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/comprobantes/${row.id}`}
                      className="hover:underline"
                    >
                      {row.numero == null
                        ? "—"
                        : `${String(row.punto_venta).padStart(5, "0")}-${String(row.numero).padStart(8, "0")}`}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    {row.client_legal_name}
                  </TableCell>
                  <TableCell>
                    {row.channel_is_fiscal && row.letter
                      ? `${COMPROBANTE_KIND_LABEL[row.kind]} ${row.letter}`
                      : COMPROBANTE_KIND_LABEL[row.kind]}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatArgentineDate(row.fecha)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${row.imp_total.toLocaleString("es-AR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={STATUS_TONE[row.status]}
                    >
                      {COMPROBANTE_STATUS_LABEL[row.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div ref={sentinelRef} className="h-px" />
        {isFetchingNextPage && (
          <div className="border-t py-3 text-center text-xs text-muted-foreground">
            Cargando más…
          </div>
        )}
      </div>
    </>
  );
}
