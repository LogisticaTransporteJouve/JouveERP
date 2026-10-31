"use client";

import { Download, Eye, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { DateRangeSelector } from "@/components/date-range-selector";
import { ExportButton } from "@/components/export-button";
import { useDateRange } from "@/components/providers/date-range-provider";
import { useScope } from "@/components/providers/scope-provider";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Account } from "@/features/accounts/schema";
import type { PickedClient } from "@/features/invoices/components/client-picker";
import { NewInvoiceDialog } from "@/features/invoices/components/new-invoice-dialog";
import { PdfViewerDialog } from "@/features/invoices/components/pdf-viewer-dialog";
import { NewReceiptDialog } from "@/features/receipts/components/new-receipt-dialog";
import type { ChannelOption } from "@/features/receipts/components/receipt-form";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";
import { SCOPE_LABEL } from "@/lib/scope";

import { toast } from "sonner";

import {
  useClearClientOpeningBalance,
  useClientAccount,
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

// es-AR currency style inserts a space between $ and the number; we want
// the `$` flush against the number in this table, so we build a custom
// formatter with the helper.
import { formatNumber2 } from "@/lib/format";
import { formatInvoiceNumero } from "@/features/invoices/schema";
const formatter = { format: (n: number) => `$${formatNumber2(n)}` };

function formatMovementNumber(m: AccountMovement): string {
  if (m.source_type === "opening_balance") return "—";
  if (m.punto_venta == null || m.numero == null) return "—";
  if (m.source_type === "receipt") {
    const pos = String(m.punto_venta).padStart(5, "0");
    return `R${pos}-${String(m.numero).padStart(8, "0")}`;
  }
  return formatInvoiceNumero(m.kind, m.letter, m.punto_venta, m.numero);
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
  return m.source_type === "receipt" ? "/receipts" : `/invoices/${m.source_id}`;
}

export function ClientAccountTab({
  clientId,
  client,
  channels,
  accounts,
  actorAccess,
}: {
  clientId: string;
  client: PickedClient;
  channels: InvoiceChannelOption[];
  accounts: Account[];
  actorAccess: Access;
}) {
  const { data } = useClientAccount(clientId);
  const movements = data.movements;
  const balance = data.balance;
  const { runningBalance } = data;
  const { fiscalFilter } = useScope();
  const canIssueInvoice = userCan(actorAccess, "invoices:issue");
  const canWriteReceipt = userCan(actorAccess, "receipts:write");
  // Only the owner can touch the balance adjustment (the backend actions
  // check the same thing). For the other roles we show the buttons
  // disabled with a tooltip that explains the restriction.
  const canSetOpening = userCan(actorAccess, "opening_balances:write");
  const clearOpeningMut = useClearClientOpeningBalance();

  // Global date filter (topbar). We apply it over the movements that
  // already have the running balance computed, so each row's balance
  // reflects the real running total and isn't reset by the filter. If the
  // range is null (the "All" preset) we show everything.
  const { range } = useDateRange();
  const filteredMovements = useMemo(() => {
    if (!range) return movements;
    return movements.filter(
      (m) => m.movement_date >= range.from && m.movement_date <= range.to,
    );
  }, [movements, range]);

  // Client-side virtualization: the action returns up to 50k movements
  // in chunks of 1000, but rendering thousands of DOM rows at once makes
  // the first paint heavy. We show 100 at a time and load more on scroll
  // (same pattern as /invoices via useIntersectionObserver).
  const PAGE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => {
    // If the set changed (re-fetch or filter), we reset to the first page.
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
    clearOpeningMut.mutate(clientId, {
      onSuccess: () => toast.success("Ajuste de saldo eliminado."),
      onError: (err) => toast.error(err.message),
    });
  }, [clearOpeningMut, clientId]);

  // Ledger columns. Rows carry a per-row running balance (Saldo) and are in
  // chronological order, so sorting would corrupt their meaning →
  // enableSorting:false on every column.
  const columns = useMemo<ColumnDef<AccountMovement>[]>(
    () =>
      (
        [
          {
            id: "date",
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
            id: "type",
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
                      : m.source_type === "receipt"
                        ? "bg-muted text-muted-foreground dark:text-muted-foreground"
                        : m.kind === "nc"
                          ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                          : "bg-muted text-muted-foreground dark:text-muted-foreground"
                  }
                >
                  {movementTypeLabel(m)}
                </Badge>
              );
            },
          },
          {
            id: "document",
            header: "Documento",
            enableSorting: false,
            meta: {
              headerClassName: "w-44",
              cellClassName: "font-mono text-xs",
            },
            cell: ({ row }) => {
              const m = row.original;
              return (
                <span className="inline-flex items-center gap-2">
                  {m.source_type === "invoice" && m.source_id ? (
                    <Link href={movementHref(m)} className="hover:underline">
                      {formatMovementNumber(m)}
                    </Link>
                  ) : (
                    formatMovementNumber(m)
                  )}
                  {m.source_type === "invoice" &&
                    m.kind !== "nc" &&
                    m.outstanding != null &&
                    (m.outstanding === 0 ? (
                      <Badge
                        variant="secondary"
                        className="bg-muted text-[10px] uppercase tracking-wide text-muted-foreground dark:text-muted-foreground"
                      >
                        Pagada
                      </Badge>
                    ) : m.outstanding < m.gross_amount ? (
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
            id: "debit",
            header: "Debe",
            enableSorting: false,
            meta: { align: "right", cellClassName: "font-mono text-sm" },
            cell: ({ row }) => {
              const m = row.original;
              const isDebit = m.signed_amount > 0;
              if (!isDebit) return "";
              return (
                <span className="inline-flex flex-col items-end">
                  <span>{formatter.format(m.gross_amount)}</span>
                  {m.source_type === "invoice" &&
                    m.kind !== "nc" &&
                    m.outstanding != null &&
                    m.outstanding > 0 &&
                    m.outstanding < m.gross_amount && (
                      <span className="text-[10px] font-normal text-muted-foreground dark:text-muted-foreground">
                        Pendiente: {formatter.format(m.outstanding)}
                      </span>
                    )}
                </span>
              );
            },
          },
          {
            id: "credit",
            header: "Haber",
            enableSorting: false,
            meta: { align: "right", cellClassName: "font-mono text-sm" },
            cell: ({ row }) => {
              const m = row.original;
              const isDebit = m.signed_amount > 0;
              return !isDebit ? formatter.format(m.gross_amount) : "";
            },
          },
          {
            id: "balance",
            header: "Saldo",
            enableSorting: false,
            meta: {
              align: "right",
              cellClassName: "font-mono text-sm font-medium",
            },
            cell: ({ row }) => {
              const m = row.original;
              if (m.balance === null) return "—";
              return (
                <span
                  className={
                    m.balance > 0
                      ? "text-muted-foreground dark:text-muted-foreground"
                      : m.balance < 0
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-muted-foreground"
                  }
                >
                  {formatter.format(m.balance)}
                </span>
              );
            },
          },
          {
            id: "actions",
            header: "Acciones",
            enableSorting: false,
            meta: { align: "right", headerClassName: "w-32" },
            cell: ({ row }) => {
              const m = row.original;
              const isOpening = m.source_type === "opening_balance";
              return (
                <div className="flex items-center justify-end gap-1">
                  {isOpening ? (
                    <OwnerOnly disabled={!canSetOpening}>
                      <div className="flex items-center gap-1">
                        <OpeningBalanceDialog
                          clientId={clientId}
                          prefill
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Editar ajuste de saldo"
                              disabled={!canSetOpening}
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
                                !canSetOpening || clearOpeningMut.isPending
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
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={handleClearOpening}>
                                Borrar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </OwnerOnly>
                  ) : m.source_type === "invoice" && m.source_id ? (
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
              );
            },
          },
        ] satisfies ColumnDef<AccountMovement>[]
      ).filter((c) => runningBalance || c.id !== "balance"),
    [
      clientId,
      canSetOpening,
      clearOpeningMut.isPending,
      handleClearOpening,
      runningBalance,
    ],
  );

  // Empty state: distinguish "no movements at all" from "filtered to empty".
  const emptyMessage =
    movements.length === 0
      ? "Este cliente todavía no tiene movimientos."
      : "No hay movimientos en el período seleccionado.";

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
      <BalanceHeader
        balance={balance}
        count={movements.length}
        scopeLabel={runningBalance ? null : SCOPE_LABEL[fiscalFilter]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <DateRangeSelector />
        <ExportButton
          resource="client-account"
          params={{
            clientId,
            name: `${client.display_name ?? client.legal_name} · CUIT ${client.cuit}`,
          }}
          label="Exportar resumen"
        />
        {(canIssueInvoice || canWriteReceipt) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canIssueInvoice && (
              <OwnerOnly disabled={!canSetOpening}>
                <OpeningBalanceDialog
                  clientId={clientId}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canSetOpening}
                    >
                      <Wallet />
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

/**
 * Wraps the children in a Tooltip when `disabled=true`. The children
 * (typically a Button) receive their normal props — the tooltip only
 * attaches the explanation. Used for the balance adjustment controls
 * that only the owner can use.
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

/** `scopeLabel` set: the balance is that scope's open documents (aging), not
 *  a running balance. */
function BalanceHeader({
  balance,
  count,
  scopeLabel,
}: {
  balance: number;
  count: number;
  scopeLabel: string | null;
}) {
  const tone =
    balance > 0
      ? "text-muted-foreground dark:text-muted-foreground"
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
        <div className="text-xs text-muted-foreground">
          {scopeLabel ? `Saldo pendiente · ${scopeLabel}` : "Saldo"}
        </div>
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
