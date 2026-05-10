"use client";

import { Download, Eye } from "lucide-react";
import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useState,
  type ChangeEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import type { ComprobanteListItem } from "../actions/comprobantes-actions";
import { useComprobantesSearchInfinite } from "../hooks/use-comprobantes";
import {
  COMPROBANTE_STATUSES,
  COMPROBANTE_STATUS_LABEL,
  type ComprobanteStatus,
} from "../schema";
import { NewComprobanteDialog } from "./new-comprobante-dialog";
import { PdfViewerDialog } from "./pdf-viewer-dialog";

// Argentine convention: letter prefix glued to the number, 5 digits punto
// de venta + dash + 8 digits sequential.
function formatNumero(row: ComprobanteListItem): string {
  const number =
    row.numero == null
      ? "—"
      : `${String(row.punto_venta).padStart(5, "0")}-${String(row.numero).padStart(8, "0")}`;
  if (!row.letter) return number;
  if (row.kind === "factura") return `${row.letter}${number}`;
  const prefix = row.kind === "nc" ? `NC-${row.letter}` : `ND-${row.letter}`;
  return `${prefix} ${number}`;
}

function safeFilenamePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/[,;]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPdfFilename(row: ComprobanteListItem): string {
  const numero = formatNumero(row);
  const client = safeFilenamePart(row.client_legal_name);
  return `${numero} - ${client}.pdf`;
}

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
  is_fiscal: boolean;
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

  const deferredChannel = useDeferredValue(channel);
  const deferredStatus = useDeferredValue(status);
  const deferredQuery = useDeferredValue(debouncedQuery);

  const canIssue = userCan(actorRoles, "invoices:issue");

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
            {COMPROBANTE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {COMPROBANTE_STATUS_LABEL[s]}
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
              <TableHead>Factura</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-32 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <Suspense fallback={<ComprobantesTableSkeletonRows />}>
            <ComprobantesTableRows
              channel={deferredChannel}
              status={deferredStatus}
              query={deferredQuery}
            />
          </Suspense>
        </Table>
      </div>
    </>
  );
}

function ComprobantesTableRows({
  channel,
  status,
  query,
}: {
  channel: string | null;
  status: ComprobanteStatus | null;
  query: string;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useComprobantesSearchInfinite({ channel, status, query });

  const sentinelRef = useIntersectionObserver<HTMLTableRowElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  if (items.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell
            colSpan={6}
            className="py-10 text-center text-sm text-muted-foreground"
          >
            No hay comprobantes que coincidan.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {items.map((row) => {
        const hasPdf = row.status === "emitted";
        return (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs">
              {formatNumero(row)}
            </TableCell>
            <TableCell className="font-medium">
              {row.client_legal_name}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatArgentineDate(row.fecha)}
            </TableCell>
            <TableCell className="text-right font-mono">
              $
              {row.imp_total.toLocaleString("es-AR", {
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
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label="Ver detalle"
                >
                  <Link href={`/comprobantes/${row.id}`}>
                    <Eye className="size-4" />
                  </Link>
                </Button>
                {hasPdf && (
                  <>
                    <PdfViewerDialog id={row.id} label={formatNumero(row)} />
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      aria-label="Descargar PDF"
                    >
                      <a
                        href={`/api/comprobantes/${row.id}/pdf`}
                        download={formatPdfFilename(row)}
                      >
                        <Download className="size-4" />
                      </a>
                    </Button>
                  </>
                )}
              </div>
            </TableCell>
          </TableRow>
        );
      })}
      {hasNextPage && (
        <TableRow ref={sentinelRef}>
          <TableCell
            colSpan={6}
            className="py-3 text-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

function ComprobantesTableSkeletonRows() {
  return (
    <TableBody>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 6 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
