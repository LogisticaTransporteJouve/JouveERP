"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Account } from "@/features/accounts/schema";
import { NewPaymentOrderDialog } from "@/features/payment-orders/components/new-payment-order-dialog";
import type { ChannelOption } from "@/features/payment-orders/components/payment-order-form";
import type { PickedSupplier } from "@/features/suppliers/components/supplier-picker";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { amountToInput, formatArgentineDate } from "@/lib/format";

import { useSupplierAccount } from "../hooks/use-suppliers";

const KIND_LABEL: Record<string, string> = {
  factura: "Factura",
  nc: "NC",
  nd: "ND",
  payment_order: "OP",
};

function formatDocumentNumber(m: {
  source_type: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
}): string {
  const pos = String(m.punto_venta).padStart(4, "0");
  const num = String(m.numero).padStart(8, "0");
  if (m.source_type === "payment_order") return `OP${pos}-${num}`;
  const prefix =
    m.kind === "factura"
      ? m.letter ?? ""
      : m.kind === "nc"
        ? `NC${m.letter ? "-" + m.letter : ""}`
        : m.kind === "nd"
          ? `ND${m.letter ? "-" + m.letter : ""}`
          : "";
  return `${prefix}${pos}-${num}`;
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

  const balLabel = balanceLabel(balance);

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
        {canWriteOP && (
          <NewPaymentOrderDialog
            channels={channels}
            accounts={accounts}
            initialSupplier={supplier}
          />
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead className="text-right">Debe</TableHead>
              <TableHead className="text-right">Haber</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Sin movimientos todavía.
                </TableCell>
              </TableRow>
            ) : (
              movements.map((m) => {
                const debe = m.signed_amount > 0 ? m.signed_amount : 0;
                const haber = m.signed_amount < 0 ? -m.signed_amount : 0;
                const docNumber = formatDocumentNumber(m);
                const href =
                  m.source_type === "purchase_invoice"
                    ? `/purchases`
                    : `/payment-orders`;
                return (
                  <TableRow key={`${m.source_type}-${m.source_id}`}>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatArgentineDate(m.movement_date)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {KIND_LABEL[m.kind] ?? m.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link href={href} className="hover:underline">
                        {docNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.channel_name}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {debe > 0 ? amountToInput(debe) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {haber > 0 ? amountToInput(haber) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm ${
                        m.balance > 0 ? "" : "text-muted-foreground"
                      }`}
                    >
                      {amountToInput(m.balance)}
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
