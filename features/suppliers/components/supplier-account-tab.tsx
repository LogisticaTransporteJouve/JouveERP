"use client";

import { Eye, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DateRangeSelector } from "@/components/date-range-selector";
import { ExportButton } from "@/components/export-button";
import { useDateRange } from "@/components/providers/date-range-provider";
import { useScope } from "@/components/providers/scope-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Account } from "@/features/accounts/schema";
import { NewPaymentOrderDialog } from "@/features/payment-orders/components/new-payment-order-dialog";
import type { ChannelOption } from "@/features/payment-orders/components/payment-order-form";
import { NewPurchaseInvoiceDialog } from "@/features/purchase-invoices/components/new-purchase-invoice-dialog";
import type { PickedSupplier } from "@/features/suppliers/components/supplier-picker";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { amountToInput, formatArgentineDate } from "@/lib/format";
import { SCOPE_LABEL } from "@/lib/scope";
import { formatInvoiceNumber } from "@/features/purchase-invoices/schema";

import type { SupplierAccountMovement } from "../actions/account-actions";
import {
  useClearSupplierOpeningBalance,
  useSupplierAccount,
} from "../hooks/use-suppliers";
import { suppliersKeys } from "../lib/suppliers-keys";
import { SupplierOpeningBalanceDialog } from "./opening-balance-dialog";

const KIND_LABEL: Record<string, string> = {
  factura: "Factura",
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
  payment_order: "Orden de Pago",
  opening_balance: "Ajuste de saldo",
};

function formatDocumentNumber(m: SupplierAccountMovement): string {
  if (m.source_type === "opening_balance") return "—";
  if (!m.punto_venta || !m.numero) return "—";
  if (m.source_type === "payment_order") {
    const pos = String(m.punto_venta).padStart(5, "0");
    return `OP${pos}-${String(m.numero).padStart(8, "0")}`;
  }
  return formatInvoiceNumber({
    kind: m.kind,
    letter: m.letter,
    punto_venta: m.punto_venta,
    numero: m.numero,
  });
}

function movementHref(m: SupplierAccountMovement): string | null {
  if (!m.source_id) return null;
  if (m.source_type === "purchase_invoice") return `/purchases/${m.source_id}`;
  if (m.source_type === "payment_order")
    return `/payment-orders/${m.source_id}`;
  return null;
}

function balanceLabel(balance: number): {
  text: string;
  className: string;
} {
  if (balance > 0.005) {
    return {
      text: "Les debemos",
      className: "text-muted-foreground dark:text-muted-foreground",
    };
  }
  if (balance < -0.005) {
    return {
      text: "Saldo a favor",
      className: "text-muted-foreground dark:text-muted-foreground",
    };
  }
  return { text: "Saldo cero", className: "text-muted-foreground" };
}

export function SupplierAccountTab({
  supplierId,
  supplier,
  channels,
  accounts,
  actorAccess,
}: {
  supplierId: string;
  supplier: PickedSupplier;
  channels: ChannelOption[];
  accounts: Account[];
  actorAccess: Access;
}) {
  const { data } = useSupplierAccount(supplierId);
  const movements = data.movements;
  const balance = data.balance;
  const { runningBalance } = data;
  const { fiscalFilter } = useScope();
  const canWriteOP = userCan(actorAccess, "payment_orders:write");
  const canWritePI = userCan(actorAccess, "purchase_invoices:write");
  const isOwner = actorAccess.roles.includes("owner");
  const clearOpeningMut = useClearSupplierOpeningBalance();

  const balLabel = balanceLabel(balance);

  const { range } = useDateRange();
  const filteredMovements = useMemo(() => {
    if (!range) return movements;
    return movements.filter(
      (m) => m.movement_date >= range.from && m.movement_date <= range.to,
    );
  }, [movements, range]);

  const PAGE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [filteredMovements.length]);
  const visibleMovements = useMemo(
    () => filteredMovements.slice(0, visibleCount),
    [filteredMovements, visibleCount],
  );
  const hasMore = visibleCount < filteredMovements.length;
  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasMore)
        setVisibleCount((prev) =>
          Math.min(prev + PAGE, filteredMovements.length),
        );
    },
    { rootMargin: "200px", enabled: hasMore },
  );

  const handleClearOpening = useCallback(() => {
    clearOpeningMut.mutate(supplierId, {
      onSuccess: () => toast.success("Ajuste de saldo eliminado."),
      onError: (err) => toast.error(err.message),
    });
  }, [clearOpeningMut, supplierId]);

  useRealtimeInvalidate([
    {
      table: "purchase_invoices",
      filter: `supplier_id=eq.${supplierId}`,
      queryKeys: [suppliersKeys.account(supplierId)],
    },
    {
      table: "payment_orders",
      filter: `supplier_id=eq.${supplierId}`,
      queryKeys: [suppliersKeys.account(supplierId)],
    },
  ]);

  const columns = useMemo<ColumnDef<SupplierAccountMovement>[]>(
    () =>
      (
        [
          {
            id: "movement_date",
            header: "Fecha",
            enableSorting: false,
            meta: { headerClassName: "w-32" },
            cell: ({ row }) => (
              <span className="text-sm text-muted-foreground">
                {formatArgentineDate(row.original.movement_date)}
              </span>
            ),
          },
          {
            id: "kind",
            header: "Tipo",
            enableSorting: false,
            meta: { headerClassName: "w-40" },
            cell: ({ row }) => {
              const m = row.original;
              const isOpening = m.source_type === "opening_balance";
              return (
                <Badge
                  variant="secondary"
                  className={
                    isOpening
                      ? "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                      : m.source_type === "payment_order"
                        ? "bg-muted text-muted-foreground dark:text-muted-foreground"
                        : m.kind === "nc"
                          ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                          : "bg-muted text-muted-foreground dark:text-muted-foreground"
                  }
                >
                  {KIND_LABEL[m.kind] ?? m.kind}
                </Badge>
              );
            },
          },
          {
            id: "document",
            header: "Documento",
            enableSorting: false,
            meta: { headerClassName: "w-44" },
            cell: ({ row }) => {
              const m = row.original;
              const isFactura =
                m.source_type === "purchase_invoice" && m.kind === "factura";
              const isND =
                m.source_type === "purchase_invoice" && m.kind === "nd";
              const showOutstandingBadge =
                (isFactura || isND) &&
                m.outstanding != null &&
                m.gross_amount > 0;
              const href = movementHref(m);
              return (
                <span className="inline-flex items-center gap-2 font-mono text-xs">
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {formatDocumentNumber(m)}
                    </Link>
                  ) : (
                    formatDocumentNumber(m)
                  )}
                  {showOutstandingBadge &&
                    (m.outstanding === 0 ? (
                      <Badge
                        variant="secondary"
                        className="bg-muted text-[10px] uppercase tracking-wide text-muted-foreground dark:text-muted-foreground"
                      >
                        Pagada
                      </Badge>
                    ) : m.outstanding! < m.gross_amount ? (
                      <Badge
                        variant="secondary"
                        className="bg-muted text-[10px] uppercase tracking-wide text-muted-foreground dark:text-muted-foreground"
                      >
                        Parcial
                      </Badge>
                    ) : null)}
                </span>
              );
            },
          },
          {
            id: "channel",
            header: "Canal",
            enableSorting: false,
            meta: { cellClassName: "text-xs text-muted-foreground" },
            cell: ({ row }) => row.original.channel_name ?? "",
          },
          {
            id: "debe",
            header: "Debe",
            enableSorting: false,
            meta: { align: "right", cellClassName: "font-mono text-sm" },
            cell: ({ row }) => {
              const m = row.original;
              const debe = m.signed_amount > 0 ? m.signed_amount : 0;
              const isFactura =
                m.source_type === "purchase_invoice" && m.kind === "factura";
              const isND =
                m.source_type === "purchase_invoice" && m.kind === "nd";
              const showOutstandingBadge =
                (isFactura || isND) &&
                m.outstanding != null &&
                m.gross_amount > 0;
              if (debe <= 0) return "—";
              return (
                <span className="inline-flex flex-col items-end">
                  <span>${amountToInput(debe)}</span>
                  {showOutstandingBadge &&
                    m.outstanding != null &&
                    m.outstanding > 0 &&
                    m.outstanding < m.gross_amount && (
                      <span className="text-[10px] font-normal text-muted-foreground dark:text-muted-foreground">
                        Pendiente: ${amountToInput(m.outstanding)}
                      </span>
                    )}
                </span>
              );
            },
          },
          {
            id: "haber",
            header: "Haber",
            enableSorting: false,
            meta: { align: "right", cellClassName: "font-mono text-sm" },
            cell: ({ row }) => {
              const m = row.original;
              const haber = m.signed_amount < 0 ? -m.signed_amount : 0;
              return haber > 0 ? `$${amountToInput(haber)}` : "—";
            },
          },
          {
            id: "balance",
            header: "Saldo",
            enableSorting: false,
            meta: { align: "right" },
            cell: ({ row }) => {
              const m = row.original;
              if (m.balance === null) return "—";
              return (
                <span
                  className={`font-mono text-sm font-medium ${
                    m.balance > 0
                      ? "text-muted-foreground dark:text-muted-foreground"
                      : m.balance < 0
                        ? "text-muted-foreground dark:text-muted-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  ${amountToInput(m.balance)}
                </span>
              );
            },
          },
          {
            id: "actions",
            header: "Acciones",
            enableSorting: false,
            meta: { align: "right", headerClassName: "w-20" },
            cell: ({ row }) => {
              const m = row.original;
              const isOpening = m.source_type === "opening_balance";
              const href = movementHref(m);
              return (
                <div className="flex items-center justify-end gap-1">
                  {isOpening ? (
                    <OwnerOnly disabled={!isOwner}>
                      <div className="flex items-center gap-1">
                        <SupplierOpeningBalanceDialog
                          supplierId={supplierId}
                          prefill
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Editar ajuste de saldo"
                              disabled={!isOwner}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          }
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Borrar ajuste de saldo"
                              disabled={!isOwner || clearOpeningMut.isPending}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                ¿Borrar el ajuste de saldo?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Las imputaciones a facturas anteriores se
                                revierten. El saldo de la cuenta corriente
                                vuelve al calculado del sistema.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={handleClearOpening}>
                                Borrar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </OwnerOnly>
                  ) : href ? (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      aria-label="Ver detalle"
                    >
                      <Link href={href}>
                        <Eye className="size-4" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              );
            },
          },
        ] satisfies ColumnDef<SupplierAccountMovement>[]
      ).filter((c) => runningBalance || c.id !== "balance"),
    [
      isOwner,
      supplierId,
      clearOpeningMut.isPending,
      handleClearOpening,
      runningBalance,
    ],
  );

  const emptyMessage =
    movements.length === 0
      ? "Sin movimientos todavía."
      : "No hay movimientos en el período seleccionado.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <div className="text-xs text-muted-foreground">
            {runningBalance
              ? "Saldo actual"
              : `Saldo pendiente · ${SCOPE_LABEL[fiscalFilter]}`}
          </div>
          <div
            className={`text-2xl font-semibold font-mono ${balLabel.className}`}
          >
            ${amountToInput(Math.abs(balance))}
          </div>
          <div className={`text-xs ${balLabel.className}`}>{balLabel.text}</div>
        </div>
        <div className="text-xs text-muted-foreground">
          {movements.length} movimiento{movements.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DateRangeSelector />
        <ExportButton
          resource="supplier-account"
          params={{
            supplierId,
            name: `${supplier.display_name ?? supplier.legal_name} · CUIT ${supplier.cuit}`,
          }}
          label="Exportar resumen"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <OwnerOnly disabled={!isOwner}>
            <SupplierOpeningBalanceDialog
              supplierId={supplierId}
              trigger={
                <Button variant="outline" size="sm" disabled={!isOwner}>
                  <Wallet />
                  Ajustar saldo
                </Button>
              }
            />
          </OwnerOnly>
          {canWritePI && (
            <NewPurchaseInvoiceDialog
              initialSupplier={supplier}
              trigger={
                <Button variant="outline" size="sm">
                  <Plus />
                  Nueva factura
                </Button>
              }
            />
          )}
          {canWriteOP && (
            <NewPaymentOrderDialog
              channels={channels}
              accounts={accounts}
              initialSupplier={supplier}
              trigger={
                <Button size="sm">
                  <Plus />
                  Nueva orden de pago
                </Button>
              }
            />
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={visibleMovements}
        getRowId={(m) =>
          m.source_type === "opening_balance"
            ? `opening-${m.movement_date}`
            : `${m.source_type}-${m.source_id}`
        }
        emptyMessage={emptyMessage}
        footer={
          hasMore ? (
            <div
              ref={sentinelRef}
              className="py-4 text-center text-xs text-muted-foreground"
            >
              Cargando más movimientos…
            </div>
          ) : null
        }
      />
    </div>
  );
}

function OwnerOnly({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled: boolean;
}) {
  if (!disabled) return <>{children}</>;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">{children}</span>
        </TooltipTrigger>
        <TooltipContent>
          Solo el owner puede tocar el ajuste de saldo.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
