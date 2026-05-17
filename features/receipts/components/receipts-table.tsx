"use client";

import { Download, Eye } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SendByEmailDialog } from "@/components/send-by-email-dialog";
import { PdfViewerDialog } from "@/features/invoices/components/pdf-viewer-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { agingKeys } from "@/features/aging/lib/aging-keys";

import { useReceiptsList } from "../hooks/use-receipts";
import { receiptsKeys } from "../lib/receipts-keys";
import { formatReceiptNumber } from "../schema";
import { CancelReceiptDialog } from "./cancel-receipt-dialog";
import { EditReceiptDialog } from "./edit-receipt-dialog";
import { NewReceiptDialog } from "./new-receipt-dialog";
import type { ChannelOption } from "./receipt-form";

// Money formatter centralizado en lib/format (formatMoney).

export function ReceiptsTable({
  channels,
  actorRoles,
}: {
  channels: ChannelOption[];
  actorRoles: Role[];
}) {
  const { data } = useReceiptsList();
  const { data: accounts } = useAccountsList();
  const receipts = data.items;
  const truncated = data.nextOffset !== null;
  const canWrite = userCan(actorRoles, "receipts:write");
  const canSendEmail = userCan(actorRoles, "email:send");

  // Realtime: invalidate the list (and aging, since allocations live on
  // the parent's updated_at) whenever any receipt changes server-side.
  useRealtimeInvalidate([
    {
      table: "receipts",
      queryKeys: [receiptsKeys.all, agingKeys.all],
    },
  ]);

  return (
    <>
      {canWrite && (
        <div className="flex justify-end">
          <NewReceiptDialog channels={channels} accounts={accounts} />
        </div>
      )}

      {truncated && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          ⚠ Mostrando los 100 recibos más recientes. Usá búsqueda global (⌘K)
          para encontrar uno específico.
        </div>
      )}

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recibo</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-28 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Todavía no hay recibos. Creá el primero con el botón de
                  arriba.
                </TableCell>
              </TableRow>
            ) : (
              receipts.map((r) => {
                const isCanceled = r.status === "canceled";
                return (
                  <TableRow
                    key={r.id}
                    className={isCanceled ? "opacity-60" : undefined}
                  >
                    <TableCell className="font-mono text-sm">
                      <span className={isCanceled ? "line-through" : undefined}>
                        {formatReceiptNumber(r.punto_venta, r.numero)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/clients/${r.client_id}`}
                        className="hover:underline"
                      >
                        {r.client_legal_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatArgentineDate(r.receipt_date)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatMoney(Number(r.total_amount), r.currency)}
                    </TableCell>
                    <TableCell>
                      {isCanceled ? (
                        <Badge variant="destructive">Anulado</Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        >
                          Emitido
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label="Ver recibo"
                        >
                          <Link href={`/receipts/${r.id}`}>
                            <Eye className="size-4" />
                          </Link>
                        </Button>
                        <PdfViewerDialog
                          id={r.id}
                          label={formatReceiptNumber(r.punto_venta, r.numero)}
                          kind="receipt"
                        />
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
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
