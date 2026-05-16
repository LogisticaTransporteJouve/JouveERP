"use client";

import { Eye } from "lucide-react";
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
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import { usePaymentOrdersList } from "../hooks/use-payment-orders";
import { paymentOrdersKeys } from "../lib/payment-orders-keys";
import {
  formatPaymentOrderNumber,
  type PaymentOrderCurrency,
} from "../schema";
import { CancelPaymentOrderDialog } from "./cancel-payment-order-dialog";
import { EditPaymentOrderDialog } from "./edit-payment-order-dialog";
import { NewPaymentOrderDialog } from "./new-payment-order-dialog";
import type { ChannelOption } from "./payment-order-form";

const formatters: Record<PaymentOrderCurrency, Intl.NumberFormat> = {
  ARS: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }),
  USD: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }),
};

export function PaymentOrdersTable({
  channels,
  actorRoles,
}: {
  channels: ChannelOption[];
  actorRoles: Role[];
}) {
  const { data } = usePaymentOrdersList();
  const { data: accounts } = useAccountsList();
  const paymentOrders = data.items;
  const truncated = data.nextOffset !== null;
  const canWrite = userCan(actorRoles, "payment_orders:write");

  useRealtimeInvalidate([
    {
      table: "payment_orders",
      queryKeys: [paymentOrdersKeys.all],
    },
  ]);

  return (
    <>
      {canWrite && (
        <div className="flex justify-end">
          <NewPaymentOrderDialog channels={channels} accounts={accounts} />
        </div>
      )}

      {truncated && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          ⚠ Mostrando las 100 órdenes más recientes. Usá búsqueda global (⌘K)
          para encontrar una específica.
        </div>
      )}

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>OP</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-28 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paymentOrders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Todavía no hay órdenes de pago. Creá la primera con el botón
                  de arriba.
                </TableCell>
              </TableRow>
            ) : (
              paymentOrders.map((op) => {
                const isCanceled = op.status === "canceled";
                return (
                  <TableRow
                    key={op.id}
                    className={isCanceled ? "opacity-60" : undefined}
                  >
                    <TableCell className="font-mono text-sm">
                      <span className={isCanceled ? "line-through" : undefined}>
                        {formatPaymentOrderNumber(op.punto_venta, op.numero)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/suppliers/${op.supplier_id}`}
                        className="hover:underline"
                      >
                        {op.supplier_legal_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatArgentineDate(op.payment_date)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatters[op.currency].format(Number(op.total_amount))}
                    </TableCell>
                    <TableCell>
                      {isCanceled ? (
                        <Badge variant="destructive">Anulada</Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        >
                          Emitida
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label="Ver detalle"
                        >
                          <Link href={`/payment-orders/${op.id}`}>
                            <Eye className="size-4" />
                          </Link>
                        </Button>
                        {canWrite && !isCanceled && (
                          <EditPaymentOrderDialog
                            paymentOrderId={op.id}
                            numero={op.numero}
                            puntoVenta={op.punto_venta}
                            channels={channels}
                            accounts={accounts}
                          />
                        )}
                        {canWrite && !isCanceled && (
                          <CancelPaymentOrderDialog
                            paymentOrderId={op.id}
                            numero={op.numero}
                            puntoVenta={op.punto_venta}
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
