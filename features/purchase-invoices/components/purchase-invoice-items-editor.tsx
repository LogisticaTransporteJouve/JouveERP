"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { formatMoney } from "@/lib/format";

import {
  PURCHASE_IVA_RATE_IDS,
  PURCHASE_IVA_RATE_LABEL,
  PURCHASE_IVA_RATE_PERCENT,
  type PurchaseIvaRateId,
} from "../schema";

export type PurchaseInvoiceItemDraft = {
  description: string;
  quantity: string;
  unit_price: string;
  iva_rate_id: PurchaseIvaRateId | null;
};

export type PurchaseInvoiceItemsTotals = {
  imp_neto: number;
  imp_iva: number;
  imp_total_lines: number;
};

const ARS = { format: (n: number) => formatMoney(n, "ARS") };

function parseNumber(v: string): number {
  if (v === "") return 0;
  const cleaned = v.replace(/[^0-9.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function computeLine(draft: PurchaseInvoiceItemDraft) {
  const qty = parseNumber(draft.quantity);
  const price = parseNumber(draft.unit_price);
  const neto = +(qty * price).toFixed(2);
  const rate = draft.iva_rate_id != null
    ? PURCHASE_IVA_RATE_PERCENT[draft.iva_rate_id]
    : 0;
  const iva = +(neto * rate / 100).toFixed(2);
  const total = +(neto + iva).toFixed(2);
  return { line_neto: neto, line_iva: iva, line_total: total };
}

export function computeTotals(
  items: PurchaseInvoiceItemDraft[],
): PurchaseInvoiceItemsTotals {
  let neto = 0;
  let iva = 0;
  for (const it of items) {
    const c = computeLine(it);
    neto += c.line_neto;
    iva += c.line_iva;
  }
  const total = +(neto + iva).toFixed(2);
  return {
    imp_neto: +neto.toFixed(2),
    imp_iva: +iva.toFixed(2),
    imp_total_lines: total,
  };
}

export function emptyItem(): PurchaseInvoiceItemDraft {
  return {
    description: "",
    quantity: "1",
    unit_price: "0",
    iva_rate_id: 5,
  };
}

export function PurchaseInvoiceItemsEditor({
  items,
  onChange,
}: {
  items: PurchaseInvoiceItemDraft[];
  onChange: (items: PurchaseInvoiceItemDraft[]) => void;
}) {
  // If empty, seed with a row to prompt the user.
  useEffect(() => {
    if (items.length === 0) onChange([emptyItem()]);
  }, [items.length, onChange]);

  function updateAt(idx: number, patch: Partial<PurchaseInvoiceItemDraft>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeAt(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...items, emptyItem()]);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Descripción</th>
              <th className="px-2 py-2 text-right font-medium w-20">Cant.</th>
              <th className="px-2 py-2 text-right font-medium w-28">P. unit</th>
              <th className="px-2 py-2 text-left font-medium w-24">IVA</th>
              <th className="px-2 py-2 text-right font-medium w-28">Neto</th>
              <th className="px-2 py-2 text-right font-medium w-28">IVA</th>
              <th className="px-2 py-2 text-right font-medium w-28">Total</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const c = computeLine(it);
              return (
                <tr key={idx} className="border-t">
                  <td className="px-2 py-1">
                    <Input
                      value={it.description}
                      onChange={(e) =>
                        updateAt(idx, { description: e.target.value })
                      }
                      placeholder="Descripción del ítem"
                      className="h-8"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      value={it.quantity}
                      onChange={(e) =>
                        updateAt(idx, { quantity: e.target.value })
                      }
                      inputMode="decimal"
                      className="h-8 text-right font-mono"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      value={it.unit_price}
                      onChange={(e) =>
                        updateAt(idx, { unit_price: e.target.value })
                      }
                      inputMode="decimal"
                      className="h-8 text-right font-mono"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={it.iva_rate_id != null ? String(it.iva_rate_id) : "__none"}
                      onValueChange={(v) =>
                        updateAt(idx, {
                          iva_rate_id:
                            v === "__none" ? null : (Number(v) as PurchaseIvaRateId),
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">No gravado</SelectItem>
                        {PURCHASE_IVA_RATE_IDS.map((id) => (
                          <SelectItem key={id} value={String(id)}>
                            {PURCHASE_IVA_RATE_LABEL[id]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                    {ARS.format(c.line_neto)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                    {ARS.format(c.line_iva)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {ARS.format(c.line_total)}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAt(idx)}
                      aria-label="Eliminar ítem"
                      disabled={items.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="size-4" />
        Agregar ítem
      </Button>
    </div>
  );
}
