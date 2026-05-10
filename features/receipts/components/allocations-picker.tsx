"use client";

import { useEffect, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatArgentineDate } from "@/lib/format";

import {
  listPendingComprobantesForClientAction,
  type PendingComprobante,
} from "../actions/receipts-actions";

export type AllocationDraft = {
  comprobante_id: string;
  amount_applied: string; // input string
};

function formatComprobanteNumber(c: PendingComprobante): string {
  const pos = String(c.punto_venta).padStart(4, "0");
  const num = c.numero == null ? "—" : String(c.numero).padStart(8, "0");
  const prefix =
    c.kind === "factura"
      ? c.letter ?? ""
      : c.kind === "credit_note"
        ? `NC${c.letter ? "-" + c.letter : ""}`
        : c.kind === "debit_note"
          ? `ND${c.letter ? "-" + c.letter : ""}`
          : "";
  return `${prefix}${pos}-${num}`;
}

export function AllocationsPicker({
  clientId,
  excludeReceiptId,
  allocations,
  onChange,
}: {
  clientId: string | null;
  excludeReceiptId?: string;
  allocations: AllocationDraft[];
  onChange: (next: AllocationDraft[]) => void;
}) {
  const [pending, setPending] = useState<PendingComprobante[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setPending([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listPendingComprobantesForClientAction(clientId, excludeReceiptId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          setPending([]);
          return;
        }
        setPending(res.data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Error al cargar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, excludeReceiptId]);

  function setAlloc(comprobanteId: string, amount: string | null) {
    if (amount === null) {
      onChange(allocations.filter((a) => a.comprobante_id !== comprobanteId));
      return;
    }
    const existing = allocations.find((a) => a.comprobante_id === comprobanteId);
    if (existing) {
      onChange(
        allocations.map((a) =>
          a.comprobante_id === comprobanteId
            ? { ...a, amount_applied: amount }
            : a,
        ),
      );
    } else {
      onChange([
        ...allocations,
        { comprobante_id: comprobanteId, amount_applied: amount },
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
        Este cliente no tiene comprobantes pendientes de cobro. El recibo
        quedará a cuenta.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Imputar a comprobantes</Label>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="w-8 px-2 py-1.5"></th>
              <th className="px-2 py-1.5 text-left">Comprobante</th>
              <th className="px-2 py-1.5 text-left">Fecha</th>
              <th className="px-2 py-1.5 text-right">Saldo</th>
              <th className="px-2 py-1.5 text-right">Imputar</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((c) => {
              const alloc = allocations.find((a) => a.comprobante_id === c.id);
              const checked = !!alloc;
              return (
                <tr key={c.id} className="border-t">
                  <td className="px-2 py-1.5">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        if (v === true) {
                          setAlloc(c.id, c.outstanding.toFixed(2));
                        } else {
                          setAlloc(c.id, null);
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
                  <td className="px-2 py-1.5 text-right font-mono text-xs">
                    {c.outstanding.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      disabled={!checked}
                      value={alloc?.amount_applied ?? ""}
                      onChange={(e) => setAlloc(c.id, e.target.value)}
                      className="h-8 text-right"
                      placeholder="0.00"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
