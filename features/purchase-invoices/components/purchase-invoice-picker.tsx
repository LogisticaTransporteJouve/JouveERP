"use client";

import { FileText, Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatMoney } from "@/lib/format";

import { usePurchaseInvoicesSearch } from "../hooks/use-purchase-invoices";
import {
  formatInvoiceNumber,
  type PurchaseInvoice,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceLetter,
} from "../schema";

export interface PickedPurchaseInvoice {
  id: string;
  kind: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number;
  numero: number;
  imp_total: number;
  fecha: string;
}

const RESULT_LIMIT = 8;

const ARS = { format: (n: number) => formatMoney(n, "ARS") };

export function PurchaseInvoicePicker({
  value,
  onChange,
  supplierId,
  channelId,
  excludeId,
  disabled,
}: {
  value: PickedPurchaseInvoice | null;
  onChange: (v: PickedPurchaseInvoice | null) => void;
  supplierId: string | null;
  channelId: string | null;
  excludeId?: string | null;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query.trim(), 200);

  const searchQuery = usePurchaseInvoicesSearch(
    {
      query: debouncedQuery,
      supplierId,
      channelId,
      kind: "factura",
      excludeId: excludeId ?? null,
      status: "received",
      limit: RESULT_LIMIT,
    },
    { enabled: open && !!supplierId && !!channelId },
  );
  const results = searchQuery.data?.invoices ?? [];
  const isSearching = searchQuery.isFetching;

  function pick(inv: PurchaseInvoice) {
    onChange({
      id: inv.id,
      kind: inv.kind,
      letter: inv.letter,
      punto_venta: inv.punto_venta,
      numero: inv.numero,
      imp_total: inv.imp_total,
      fecha: inv.fecha,
    });
    setOpen(false);
    setQuery("");
  }

  function clear() {
    onChange(null);
    setQuery("");
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-medium font-mono">
            {formatInvoiceNumber(value)}
          </p>
          <p className="text-xs text-muted-foreground">
            {value.fecha} · {ARS.format(value.imp_total)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Quitar factura origen"
          onClick={clear}
          disabled={disabled}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  if (!supplierId) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Seleccioná un proveedor primero.
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar factura por número o razón social"
            className="pl-8"
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ResultsList
          results={results}
          isSearching={isSearching}
          onPick={pick}
          hasQuery={debouncedQuery.length > 0}
        />
      </PopoverContent>
    </Popover>
  );
}

function ResultsList({
  results,
  isSearching,
  onPick,
  hasQuery,
}: {
  results: PurchaseInvoice[];
  isSearching: boolean;
  onPick: (inv: PurchaseInvoice) => void;
  hasQuery: boolean;
}) {
  if (isSearching) {
    return (
      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
        Buscando…
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
        {hasQuery
          ? "Sin facturas para este proveedor."
          : "Empezá a tipear o esperá el listado del proveedor."}
      </div>
    );
  }
  return (
    <ul className="max-h-[320px] overflow-y-auto py-1">
      {results.map((inv) => (
        <li key={inv.id}>
          <button
            type="button"
            onClick={() => onPick(inv)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium font-mono">
                {formatInvoiceNumber(inv)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {inv.fecha} · {ARS.format(inv.imp_total)}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
