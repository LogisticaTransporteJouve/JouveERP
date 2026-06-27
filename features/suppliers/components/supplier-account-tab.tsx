"use client";

import { Eye, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DateRangeSelector } from "@/components/date-range-selector";
import { useDateRange } from "@/components/providers/date-range-provider";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { amountToInput, formatArgentineDate } from "@/lib/format";

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
  const pos = String(m.punto_venta).padStart(4, "0");
  const num = String(m.numero).padStart(8, "0");
  if (m.source_type === "payment_order") return `OP${pos}-${num}`;
  const prefix =
    m.kind === "factura"
      ? m.letter ?? ""
      : m.kind === "nc"
        ? "NC"
        : m.kind === "nd"
          ? "ND"
          : "";
  return `${prefix}${pos}-${num}`;
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
      className: "text-amber-600 dark:text-amber-400",
    };
  }
  if (balance < -0.005) {
    return {
      text: "Saldo a favor",
      className: "text-emerald-600 dark:text-emerald-400",
    };
  }
  return { text: "Saldo cero", className: "text-muted-foreground" };
}

export function SupplierAccountTab({
  supplierId,
  supplier,
  channels,
  accounts,
  actorRoles,
}: {
  supplierId: string;
  supplier: PickedSupplier;
  channels: ChannelOption[];
  accounts: Account[];
  actorRoles: Role[];
}) {
  const { data } = useSupplierAccount(supplierId);
  const movements = data.movements;
  const balance = data.balance;
  const canWriteOP = userCan(actorRoles, "payment_orders:write");
  const canWritePI = userCan(actorRoles, "purchase_invoices:write");
  const isOwner = actorRoles.includes("owner");
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
  const sentinelRef = useIntersectionObserver<HTMLTableRowElement>(
    () => {
      if (hasMore)
        setVisibleCount((prev) =>
          Math.min(prev + PAGE, filteredMovements.length),
        );
    },
    { rootMargin: "200px", enabled: hasMore },
  );

  function handleClearOpening() {
    clearOpeningMut.mutate(supplierId, {
      onSuccess: () => toast.success("Ajuste de saldo eliminado."),
      onError: (err) => toast.error(err.message),
    });
  }

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <div className="text-xs text-muted-foreground">Saldo actual</div>
          <div className={`text-2xl font-semibold font-mono ${balLabel.className}`}>
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

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Fecha</TableHead>
              <TableHead className="w-40">Tipo</TableHead>
              <TableHead className="w-44">Documento</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead className="text-right">Debe</TableHead>
              <TableHead className="text-right">Haber</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="w-20 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMovements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {movements.length === 0
                    ? "Sin movimientos todavía."
                    : "No hay movimientos en el período seleccionado."}
                </TableCell>
              </TableRow>
            ) : (
              visibleMovements.map((m) => {
                const debe = m.signed_amount > 0 ? m.signed_amount : 0;
                const haber = m.signed_amount < 0 ? -m.signed_amount : 0;
                const isOpening = m.source_type === "opening_balance";
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
                  <TableRow
                    key={
                      isOpening
                        ? `opening-${m.movement_date}`
                        : `${m.source_type}-${m.source_id}`
                    }
                  >
                    <TableCell className="text-sm text-muted-foreground">
                      {formatArgentineDate(m.movement_date)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          isOpening
                            ? "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                            : m.source_type === "payment_order"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : m.kind === "nc"
                                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        }
                      >
                        {KIND_LABEL[m.kind] ?? m.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <span className="inline-flex items-center gap-2">
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
                              className="bg-emerald-500/15 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                            >
                              Pagada
                            </Badge>
                          ) : m.outstanding! < m.gross_amount ? (
                            <Badge
                              variant="secondary"
                              className="bg-amber-500/15 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300"
                            >
                              Parcial
                            </Badge>
                          ) : null)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.channel_name ?? ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {debe > 0 ? (
                        <span className="inline-flex flex-col items-end">
                          <span>${amountToInput(debe)}</span>
                          {showOutstandingBadge &&
                            m.outstanding != null &&
                            m.outstanding > 0 &&
                            m.outstanding < m.gross_amount && (
                              <span className="text-[10px] font-normal text-amber-600 dark:text-amber-400">
                                Pendiente: ${amountToInput(m.outstanding)}
                              </span>
                            )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {haber > 0 ? `$${amountToInput(haber)}` : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm font-medium ${
                        m.balance > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : m.balance < 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      ${amountToInput(m.balance)}
                    </TableCell>
                    <TableCell>
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
                                    disabled={
                                      !isOwner || clearOpeningMut.isPending
                                    }
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
                                    <AlertDialogCancel>
                                      Cancelar
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={handleClearOpening}
                                    >
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
                    </TableCell>
                  </TableRow>
                );
              })
            )}
            {hasMore && (
              <TableRow ref={sentinelRef}>
                <TableCell
                  colSpan={8}
                  className="py-4 text-center text-xs text-muted-foreground"
                >
                  Cargando más movimientos…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
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
