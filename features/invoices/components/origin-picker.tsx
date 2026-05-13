"use client";

import { Loader2, Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import type { InvoiceListItem } from "../actions/invoices-actions";
import { useOriginSearch } from "../hooks/use-invoices";

// Argentine convention: letter glued to the POS (no space). The picker
// only lists facturas, so we never get the "NC-A 00003-…" form here.
function formatNumero(letter: string | null, pos: number, numero: number) {
  return `${letter ?? "X"}${String(pos).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

function formatARS(amount: number) {
  return amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * OriginPicker — combobox-style picker para facturas fiscales emitidas que
 * sirven de origen a una NC o ND. Cuando hay value, muestra una pill
 * compacta con los datos clave y un botón "Cambiar". Sin value, muestra
 * un search input que abre un popover con resultados.
 */
export function OriginPicker({
  value,
  onChange,
}: {
  value: InvoiceListItem | null;
  onChange: (next: InvoiceListItem | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const debounced = useDebouncedValue(queryInput.trim(), 250);
  const { data: items = [], isFetching } = useOriginSearch(debounced, open);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="font-mono text-xs">
            {formatNumero(value.letter, value.punto_venta, value.numero)}
          </p>
          <p className="truncate font-medium">{value.client_legal_name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {value.fecha} · ${formatARS(value.imp_total)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cambiar factura origen"
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente o número"
            className="pl-8"
            value={queryInput}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQueryInput(e.target.value);
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
        <div className="max-h-72 overflow-y-auto">
          {isFetching && items.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Buscando…
            </div>
          ) : items.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {debounced.length === 0
                ? "Las facturas fiscales emitidas más recientes aparecen acá."
                : "No hay resultados."}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(it);
                      setOpen(false);
                      setQueryInput("");
                    }}
                    className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="font-mono text-xs">
                        {formatNumero(it.letter, it.punto_venta, it.numero)}
                      </span>
                      <span className="truncate">{it.client_legal_name}</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 text-xs">
                      <span className="font-mono">${formatARS(it.imp_total)}</span>
                      <span className="text-muted-foreground">{it.fecha}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
