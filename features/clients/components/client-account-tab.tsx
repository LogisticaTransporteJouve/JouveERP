"use client";

import { Download, Eye, Plus } from "lucide-react";
import Link from "next/link";

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

import { useClientAccount } from "../hooks/use-clients";
import type { AccountMovement } from "../actions/account-actions";
import { clientsKeys } from "../lib/clients-keys";

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
  const pos = String(m.punto_venta).padStart(4, "0");
  const num = String(m.numero).padStart(8, "0");
  if (m.source_type === "recibo") return `R${pos}-${num}`;
  if (m.kind === "factura") return `${m.letter ?? ""}${pos}-${num}`;
  if (m.kind === "nc") return `NC-${m.letter ?? ""} ${pos}-${num}`;
  if (m.kind === "nd") return `ND-${m.letter ?? ""} ${pos}-${num}`;
  return `${pos}-${num}`;
}

function movementTypeLabel(m: AccountMovement): string {
  if (m.source_type === "recibo") return "Recibo";
  if (m.kind === "factura") return `Factura${m.letter ? " " + m.letter : ""}`;
  if (m.kind === "nc") return `NC${m.letter ? " " + m.letter : ""}`;
  if (m.kind === "nd") return `ND${m.letter ? " " + m.letter : ""}`;
  return m.kind;
}

function movementHref(m: AccountMovement): string {
  return m.source_type === "recibo"
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
  const canIssueInvoice = userCan(actorRoles, "invoices:issue");
  const canWriteReceipt = userCan(actorRoles, "receipts:write");

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

      {(canIssueInvoice || canWriteReceipt) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
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
              <TableHead className="w-32 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Este cliente todavía no tiene movimientos.
                </TableCell>
              </TableRow>
            ) : (
              movements.map((m) => {
                const isDebit = m.signed_amount > 0;
                return (
                  <TableRow key={`${m.source_type}-${m.source_id}`}>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatArgentineDate(m.movement_date)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          m.source_type === "recibo"
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
                      {m.source_type === "comprobante" ? (
                        <Link
                          href={movementHref(m)}
                          className="hover:underline"
                        >
                          {formatMovementNumber(m)}
                        </Link>
                      ) : (
                        formatMovementNumber(m)
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.channel_name}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {isDebit ? formatter.format(m.gross_amount) : ""}
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
                        {m.source_type === "comprobante" ? (
                          <>
                            <Button
                              asChild
                              variant="ghost"
                              size="icon"
                              aria-label="Ver comprobante"
                            >
                              <Link href={`/invoices/${m.source_id}`}>
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
                        ) : (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            aria-label="Ver recibo"
                          >
                            <Link href="/receipts">
                              <Eye className="size-4" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
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
