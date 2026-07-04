"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  amountToInput,
  formatAmountInput,
  formatArgentineDate,
  parseArAmount,
} from "@/lib/format";

import type { PendingPurchaseInvoice } from "../actions/payment-orders-actions";
import { usePendingPurchaseInvoices } from "../hooks/use-payment-orders";

export type AllocationDraft = {
  purchase_invoice_id: string;
  amount_applied: string;
};

function formatInvoiceNumber(c: PendingPurchaseInvoice): string {
  const pos = String(c.punto_venta).padStart(4, "0");
  const num = String(c.numero).padStart(8, "0");
  const prefix =
    c.kind === "factura"
      ? c.letter ?? ""
      : c.kind === "nc"
        ? `NC${c.letter ? "-" + c.letter : ""}`
        : c.kind === "nd"
          ? `ND${c.letter ? "-" + c.letter : ""}`
          : "";
  return `${prefix}${pos}-${num}`;
}

export function AllocationsPicker({
  supplierId,
  excludePaymentOrderId,
  allocations,
  onChange,
}: {
  supplierId: string | null;
  excludePaymentOrderId?: string;
  allocations: AllocationDraft[];
  onChange: (next: AllocationDraft[]) => void;
}) {
  const pendingQuery = usePendingPurchaseInvoices(
    supplierId,
    excludePaymentOrderId,
  );
  const pending: PendingPurchaseInvoice[] = pendingQuery.data ?? [];
  const loading = pendingQuery.isLoading;
  const error = pendingQuery.error?.message ?? null;
  const [collapsed, setCollapsed] = useState(false);

  function setAlloc(invoiceId: string, amount: string | null) {
    if (amount === null) {
      onChange(
        allocations.filter((a) => a.purchase_invoice_id !== invoiceId),
      );
      return;
    }
    const existing = allocations.find((a) => a.purchase_invoice_id === invoiceId);
    if (existing) {
      onChange(
        allocations.map((a) =>
          a.purchase_invoice_id === invoiceId
            ? { ...a, amount_applied: amount }
            : a,
        ),
      );
    } else {
      onChange([
        ...allocations,
        { purchase_invoice_id: invoiceId, amount_applied: amount },
      ]);
    }
  }

  if (!supplierId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        Elegí un proveedor para ver sus facturas pendientes.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="rounded-md border p-3 text-center text-xs text-muted-foreground">
        Cargando facturas pendientes…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        {error}
      </div>
    );
  }
  if (pending.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        Este proveedor no tiene facturas pendientes de pago. La OP quedará a
        cuenta.
      </div>
    );
  }

  const selectedCount = allocations.length;
  const selectedTotal = allocations.reduce(
    (acc, a) => acc + (parseArAmount(a.amount_applied) ?? 0),
    0,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Imputar a facturas</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed((c) => !c)}
          className="h-7 gap-1 text-xs text-muted-foreground"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
          {collapsed
            ? `Mostrar (${pending.length} pendiente${pending.length === 1 ? "" : "s"}${
                selectedCount > 0
                  ? ` · ${selectedCount} imputada${selectedCount === 1 ? "" : "s"} · ${amountToInput(selectedTotal)}`
                  : ""
              })`
            : "Ocultar tabla"}
        </Button>
      </div>
      {collapsed ? null : (
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="w-8 px-2 py-1.5"></th>
              <th className="px-2 py-1.5 text-left">Comprobante</th>
              <th className="px-2 py-1.5 text-left">Fecha</th>
              <th className="px-2 py-1.5 text-right">Original</th>
              <th className="px-2 py-1.5 text-right">Adeudado</th>
              <th className="px-2 py-1.5 text-right">Imputar</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((c) => {
              const alloc = allocations.find(
                (a) => a.purchase_invoice_id === c.id,
              );
              const checked = !!alloc;
              const isPartial = c.already_allocated > 0;
              return (
                <tr key={c.id} className="border-t">
                  <td className="px-2 py-1.5">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        if (v === true) {
                          setAlloc(c.id, amountToInput(c.outstanding));
                        } else {
                          setAlloc(c.id, null);
                        }
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {formatInvoiceNumber(c)}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">
                    {formatArgentineDate(c.fecha)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground">
                    {amountToInput(c.imp_total)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">
                    <div className="flex flex-col items-end">
                      <span
                        className={
                          isPartial ? "text-muted-foreground dark:text-muted-foreground" : ""
                        }
                      >
                        {amountToInput(c.outstanding)}
                      </span>
                      {isPartial && (
                        <span className="text-[10px] text-muted-foreground">
                          Pagado: {amountToInput(c.already_allocated)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="text"
                      inputMode="decimal"
                      disabled={!checked}
                      value={alloc?.amount_applied ?? ""}
                      onChange={(e) =>
                        setAlloc(c.id, formatAmountInput(e.target.value))
                      }
                      className="h-8 text-right"
                      placeholder="0,00"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
