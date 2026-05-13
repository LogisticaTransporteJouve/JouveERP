"use client";

import { Download, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRangeSelector } from "@/components/date-range-selector";
import { useDateRange } from "@/components/providers/date-range-provider";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Account } from "@/features/accounts/schema";
import type { PickedClient } from "@/features/invoices/components/client-picker";
import { NewInvoiceDialog } from "@/features/invoices/components/new-invoice-dialog";
import { PdfViewerDialog } from "@/features/invoices/components/pdf-viewer-dialog";
import { NewReceiptDialog } from "@/features/receipts/components/new-receipt-dialog";
import type { ChannelOption } from "@/features/receipts/components/receipt-form";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { toast } from "sonner";

import {
  useClearClientOpeningBalance,
  useClientAccount,
  useClientOpeningBalance,
} from "../hooks/use-clients";
import type { AccountMovement } from "../actions/account-actions";
import { clientsKeys } from "../lib/clients-keys";
import { OpeningBalanceDialog } from "./opening-balance-dialog";

interface InvoiceChannelOption {
  id: string;
  name: string;
  division: string;
  is_fiscal: boolean;
}


const decimalFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// es-AR currency style inserts a space between $ and the number; we want
// them tight, so format as decimal and prefix `$` manually.
const formatter = {
  format: (value: number) => `$${decimalFormatter.format(value)}`,
};

function formatMovementNumber(m: AccountMovement): string {
  if (m.source_type === "opening_balance") return "—";
  if (m.punto_venta == null || m.numero == null) return "—";
  const pos = String(m.punto_venta).padStart(4, "0");
  const num = String(m.numero).padStart(8, "0");
  if (m.source_type === "receipt") return `R${pos}-${num}`;
  if (m.kind === "factura") return `${m.letter ?? ""}${pos}-${num}`;
  if (m.kind === "nc") return `NC-${m.letter ?? ""} ${pos}-${num}`;
  if (m.kind === "nd") return `ND-${m.letter ?? ""} ${pos}-${num}`;
  return `${pos}-${num}`;
}

function movementTypeLabel(m: AccountMovement): string {
  if (m.source_type === "opening_balance") return "Ajuste de saldo";
  if (m.source_type === "receipt") return "Recibo";
  if (m.kind === "factura") return `Factura${m.letter ? " " + m.letter : ""}`;
  if (m.kind === "nc") return "Nota de Crédito";
  if (m.kind === "nd") return "Nota de Débito";
  return m.kind;
}

function movementHref(m: AccountMovement): string {
  return m.source_type === "receipt"
    ? "/receipts"
    : `/invoices/${m.source_id}`;
}

export function ClientAccountTab({
  clientId,
  client,
  channels,
  accounts,
  actorRoles,
}: {
  clientId: string;
  client: PickedClient;
  channels: InvoiceChannelOption[];
  accounts: Account[];
  actorRoles: Role[];
}) {
  const { data } = useClientAccount(clientId);
  const movements = data.movements;
  const balance = data.balance;
  const { data: existingOpening } = useClientOpeningBalance(clientId);
  const canIssueInvoice = userCan(actorRoles, "invoices:issue");
  const canWriteReceipt = userCan(actorRoles, "receipts:write");
  // El ajuste de saldo solo lo puede tocar el owner (acciones backend
  // chequean lo mismo). Para los demás roles mostramos los botones
  // deshabilitados con un tooltip que explica la restricción.
  const isOwner = actorRoles.includes("owner");
  const clearOpeningMut = useClearClientOpeningBalance();

  // Filtro global de fechas (topbar). Lo aplicamos sobre los movimientos
  // ya con running balance computado, así el saldo de cada fila refleja
  // el acumulado real y no se reinicia por el filtro. Si el rango es
  // null (preset "Todo") mostramos todo.
  const { range } = useDateRange();
  const filteredMovements = useMemo(() => {
    if (!range) return movements;
    return movements.filter(
      (m) => m.movement_date >= range.from && m.movement_date <= range.to,
    );
  }, [movements, range]);

  // Virtualización client-side: la action devuelve hasta 50k movimientos
  // en chunks de 1000, pero renderizar miles de filas DOM al toque hace
  // que el primer paint sea pesado. Mostramos de a 100 y cargamos más al
  // scrollear (mismo patrón que /invoices vía useIntersectionObserver).
  const PAGE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => {
    // Si el set cambió (re-fetch o filtro), reseteamos al primer page.
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
    clearOpeningMut.mutate(clientId, {
      onSuccess: () => toast.success("Ajuste de saldo eliminado."),
      onError: (err) => toast.error(err.message),
    });
  }

  // Realtime: subscribe with a server-side filter so we only get events
  // for THIS client's comprobantes / receipts. Saves the client from
  // refetching on every other client's activity.
  useRealtimeInvalidate([
    {
      table: "invoices",
      filter: `client_id=eq.${clientId}`,
      queryKeys: [clientsKeys.account(clientId)],
    },
    {
      table: "receipts",
      filter: `client_id=eq.${clientId}`,
      queryKeys: [clientsKeys.account(clientId)],
    },
  ]);

  return (
    <div className="space-y-4">
      <BalanceHeader balance={balance} count={movements.length} />

      <div className="flex flex-wrap items-center gap-2">
        <DateRangeSelector />
        {(canIssueInvoice || canWriteReceipt) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canIssueInvoice && !existingOpening && (
              <OwnerOnly disabled={!isOwner}>
                <OpeningBalanceDialog
                  clientId={clientId}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!isOwner}
                    >
                      <Pencil />
                      Ajustar saldo
                    </Button>
                  }
                />
              </OwnerOnly>
            )}
            {canIssueInvoice && (
              <NewInvoiceDialog
                channels={channels}
                initialClient={client}
                trigger={
                  <Button variant="outline" size="sm">
                    <Plus />
                    Nuevo comprobante
                  </Button>
                }
              />
            )}
            {canWriteReceipt && (
              <NewReceiptDialog
                channels={channels as ChannelOption[]}
                accounts={accounts}
                initialClient={client}
                trigger={
                  <Button size="sm">
                    <Plus />
                    Nuevo recibo
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Fecha</TableHead>
              <TableHead className="w-40">Tipo</TableHead>
              <TableHead className="w-44">Documento</TableHead>
              <TableHead className="text-right">Debe</TableHead>
              <TableHead className="text-right">Haber</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="w-32 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Este cliente todavía no tiene movimientos.
                </TableCell>
              </TableRow>
            ) : (
              visibleMovements.map((m) => {
                const isDebit = m.signed_amount > 0;
                const isOpening = m.source_type === "opening_balance";
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
                            : m.source_type === "receipt"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : m.kind === "nc"
                                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        }
                      >
                        {movementTypeLabel(m)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <span className="inline-flex items-center gap-2">
                        {m.source_type === "invoice" && m.source_id ? (
                          <Link
                            href={movementHref(m)}
                            className="hover:underline"
                          >
                            {formatMovementNumber(m)}
                          </Link>
                        ) : (
                          formatMovementNumber(m)
                        )}
                        {m.source_type === "invoice" &&
                          m.kind !== "credit_note" &&
                          m.outstanding != null &&
                          (m.outstanding === 0 ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-500/15 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                            >
                              Pagada
                            </Badge>
                          ) : m.outstanding < m.gross_amount ? (
                            <Badge
                              variant="secondary"
                              className="bg-amber-500/15 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300"
                            >
                              Parcial
                            </Badge>
                          ) : null)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {isDebit ? (
                        <span className="inline-flex flex-col items-end">
                          <span>{formatter.format(m.gross_amount)}</span>
                          {m.source_type === "invoice" &&
                            m.kind !== "credit_note" &&
                            m.outstanding != null &&
                            m.outstanding > 0 &&
                            m.outstanding < m.gross_amount && (
                              <span className="text-[10px] font-normal text-amber-600 dark:text-amber-400">
                                Pendiente: {formatter.format(m.outstanding)}
                              </span>
                            )}
                        </span>
                      ) : (
                        ""
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {!isDebit ? formatter.format(m.gross_amount) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium">
                      <span
                        className={
                          m.balance > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : m.balance < 0
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-muted-foreground"
                        }
                      >
                        {formatter.format(m.balance)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {isOpening ? (
                          <OwnerOnly disabled={!isOwner}>
                            <div className="flex items-center gap-1">
                              <OpeningBalanceDialog
                                clientId={clientId}
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
                                      Las imputaciones a facturas anteriores
                                      se revierten. El saldo de la cuenta
                                      corriente vuelve al calculado del
                                      sistema.
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
                        ) : m.source_type === "invoice" &&
                          m.source_id ? (
                          <>
                            <Button
                              asChild
                              variant="ghost"
                              size="icon"
                              aria-label="Ver comprobante"
                            >
                              <Link
                                href={`/invoices/${m.source_id}?from=client&clientId=${clientId}`}
                              >
                                <Eye className="size-4" />
                              </Link>
                            </Button>
                            <PdfViewerDialog
                              id={m.source_id}
                              label={formatMovementNumber(m)}
                            />
                            <Button
                              asChild
                              variant="ghost"
                              size="icon"
                              aria-label="Descargar PDF"
                            >
                              <Link href={`/api/invoices/${m.source_id}/pdf`}>
                                <Download className="size-4" />
                              </Link>
                            </Button>
                          </>
                        ) : m.source_id ? (
                          <>
                            <Button
                              asChild
                              variant="ghost"
                              size="icon"
                              aria-label="Ver recibo"
                            >
                              <Link
                                href={`/receipts/${m.source_id}?from=client&clientId=${clientId}`}
                              >
                                <Eye className="size-4" />
                              </Link>
                            </Button>
                            <PdfViewerDialog
                              id={m.source_id}
                              label={formatMovementNumber(m)}
                              kind="receipt"
                            />
                            <Button
                              asChild
                              variant="ghost"
                              size="icon"
                              aria-label="Descargar PDF"
                            >
                              <Link href={`/api/receipts/${m.source_id}/pdf`}>
                                <Download className="size-4" />
                              </Link>
                            </Button>
                          </>
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
                  colSpan={7}
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

/**
 * Envuelve el children en un Tooltip cuando `disabled=true`. El children
 * (típicamente un Button) recibe sus props normales — el tooltip solo
 * adjunta la explicación. Usado para los controles de ajuste de saldo
 * que solo el owner puede usar.
 */
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

function BalanceHeader({
  balance,
  count,
}: {
  balance: number;
  count: number;
}) {
  const tone =
    balance > 0
      ? "text-amber-600 dark:text-amber-400"
      : balance < 0
        ? "text-blue-600 dark:text-blue-400"
        : "text-muted-foreground";
  const label =
    balance > 0
      ? "El cliente nos debe"
      : balance < 0
        ? "Le debemos al cliente"
        : "Saldo en cero";
  return (
    <div className="flex items-end justify-between rounded-lg border bg-muted/30 p-4">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Saldo</div>
        <div className={`font-mono text-2xl font-semibold ${tone}`}>
          {formatter.format(balance)}
        </div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
      <div className="text-xs text-muted-foreground">
        {count} movimiento{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}
