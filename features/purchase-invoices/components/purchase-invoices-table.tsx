"use client";

import { Eye } from "lucide-react";
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

import { usePurchaseInvoicesSearchInfinite } from "../hooks/use-purchase-invoices";
import { type PurchaseInvoicesFilters } from "../lib/purchase-invoices-keys";
import {
  PURCHASE_INVOICE_KIND_LABEL,
  PURCHASE_INVOICE_STATUSES,
  PURCHASE_INVOICE_STATUS_LABEL,
  formatInvoiceNumber,
} from "../schema";
import { CancelPurchaseInvoiceDialog } from "./cancel-purchase-invoice-dialog";
import { EditPurchaseInvoiceDialog } from "./edit-purchase-invoice-dialog";
import { NewPurchaseInvoiceDialog } from "./new-purchase-invoice-dialog";

export function PurchaseInvoicesTable({
  actorRoles,
  initialQuery,
  initialStatus,
}: {
  actorRoles: Role[];
  initialQuery: string;
  initialStatus: string | null;
}) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [status, setStatus] = useState<string | null>(initialStatus);

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorRoles, "purchase_invoices:write");
  const canCancel = userCan(actorRoles, "purchase_invoices:cancel");

  useEffect(() => {
    setUrlFilters({
      q: debouncedQuery || null,
      status: status ?? null,
    });
  }, [debouncedQuery, status, setUrlFilters]);

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setQueryInput(event.target.value);
  }

  const filters: PurchaseInvoicesFilters = {
    query: debouncedQuery,
    supplierId: null,
    channelId: null,
    status,
    fechaFrom: null,
    fechaTo: null,
  };
  const deferredFilters = useDeferredValue(filters);

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
        {canWrite && (
          <div className="ml-auto">
            <NewPurchaseInvoiceDialog />
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Comprobante</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <Suspense fallback={<PurchaseInvoicesSkeletonRows />}>
            <PurchaseInvoicesRows
              filters={deferredFilters}
              canWrite={canWrite}
              canCancel={canCancel}
            />
          </Suspense>
        </Table>
      </div>
    </>
  );
}

function PurchaseInvoicesRows({
  filters,
  canWrite,
  canCancel,
}: {
  filters: PurchaseInvoicesFilters;
  canWrite: boolean;
  canCancel: boolean;
}) {
  const {
    items,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePurchaseInvoicesSearchInfinite(filters);

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
            No hay facturas que coincidan.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {items.map((inv) => (
        <TableRow
          key={inv.id}
          className={inv.status === "cancelled" ? "opacity-60" : undefined}
        >
          <TableCell className="font-mono text-xs">
            <div className="font-medium">
              {PURCHASE_INVOICE_KIND_LABEL[inv.kind]}
            </div>
            <div className="text-muted-foreground">
              {formatInvoiceNumber(inv)}
            </div>
          </TableCell>
          <TableCell>
            <Link
              href={`/suppliers/${inv.supplier_id}`}
              className="font-medium hover:underline"
            >
              {inv.supplier_legal_name}
            </Link>
            <div className="font-mono text-xs text-muted-foreground">
              CUIT {inv.supplier_cuit}
            </div>
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {formatArgentineDate(inv.fecha)}
          </TableCell>
          <TableCell className="text-right font-mono">
            {inv.moneda === "PES" ? "$" : "US$"}
            {inv.imp_total.toLocaleString("es-AR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </TableCell>
          <TableCell>
            <Badge
              variant="secondary"
              className={
                inv.status === "cancelled"
                  ? "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              }
            >
              {PURCHASE_INVOICE_STATUS_LABEL[inv.status]}
            </Badge>
          </TableCell>
          <TableCell>
            <div className="flex items-center justify-end gap-1">
              <Button asChild variant="ghost" size="icon" aria-label="Ver detalle">
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
          </TableCell>
        </TableRow>
      ))}
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

function PurchaseInvoicesSkeletonRows() {
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
