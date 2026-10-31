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
import { formatInvoiceNumero } from "@/features/invoices/schema";

import type { PendingComprobante } from "../actions/receipts-actions";
import { usePendingComprobantes } from "../hooks/use-receipts";

export type AllocationDraft = {
  /** The comprobante or the rejected check (see document_type). */
  document_id: string;
  document_type: PendingComprobante["document_type"];
  amount_applied: string; // input string
};

function formatComprobanteNumber(c: PendingComprobante): string {
  if (c.document_type === "rejected_check") {
    const receipt =
      c.numero == null
        ? ""
        : ` (R${String(c.punto_venta).padStart(5, "0")}-${String(c.numero).padStart(8, "0")})`;
    return `Cheque rechazado ${c.check_number ?? ""}${receipt}`;
  }
  return formatInvoiceNumero(c.kind, c.letter, c.punto_venta, c.numero);
}

export function AllocationsPicker({
  clientId,
  channelId,
  excludeReceiptId,
  allocations,
  onChange,
}: {
  clientId: string | null;
  channelId: string | null;
  excludeReceiptId?: string;
  allocations: AllocationDraft[];
  onChange: (next: AllocationDraft[]) => void;
}) {
  const pendingQuery = usePendingComprobantes(
    clientId,
    channelId,
    excludeReceiptId,
  );
  const pending: PendingComprobante[] = pendingQuery.data ?? [];
  const loading = pendingQuery.isLoading;
  const error = pendingQuery.error?.message ?? null;
  const [collapsed, setCollapsed] = useState(false);

  function setAlloc(doc: PendingComprobante, amount: string | null) {
    if (amount === null) {
      onChange(allocations.filter((a) => a.document_id !== doc.id));
      return;
    }
    const existing = allocations.find((a) => a.document_id === doc.id);
    if (existing) {
      onChange(
        allocations.map((a) =>
          a.document_id === doc.id ? { ...a, amount_applied: amount } : a,
        ),
      );
    } else {
      onChange([
        ...allocations,
        {
          document_id: doc.id,
          document_type: doc.document_type,
          amount_applied: amount,
        },
      ]);
    }
  }

  if (!clientId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        Elegí un cliente para ver sus comprobantes pendientes.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="rounded-md border p-3 text-center text-xs text-muted-foreground">
        Cargando comprobantes pendientes…
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
        Este cliente no tiene comprobantes ni cheques rechazados pendientes de
        cobro. El recibo quedará a cuenta.
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
        <Label className="text-sm font-medium">Imputar a comprobantes</Label>
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
                  ? ` · ${selectedCount} imputado${selectedCount === 1 ? "" : "s"} · ${amountToInput(selectedTotal)}`
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
                const alloc = allocations.find((a) => a.document_id === c.id);
                const checked = !!alloc;
                const isPartial = c.already_allocated > 0;
                return (
                  <tr key={c.id} className="border-t">
                    <td className="px-2 py-1.5">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          if (v === true) {
                            setAlloc(c, amountToInput(c.outstanding));
                          } else {
                            setAlloc(c, null);
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">
                      {formatComprobanteNumber(c)}
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
                            isPartial
                              ? "text-muted-foreground dark:text-muted-foreground"
                              : ""
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
                          setAlloc(c, formatAmountInput(e.target.value))
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
