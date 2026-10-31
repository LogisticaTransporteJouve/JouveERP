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

import {
  usePurchaseInvoiceByIdOptional,
  usePurchaseInvoicesSearch,
} from "../hooks/use-purchase-invoices";
import { formatInvoiceNumber, type PurchaseInvoice } from "../schema";

const RESULT_LIMIT = 8;

function invoiceSummary(inv: PurchaseInvoice): string {
  return `${inv.supplier_legal_name} · ${inv.fecha} · ${formatMoney(inv.imp_total, inv.moneda)}`;
}

/**
 * Links a record to a received purchase invoice of any supplier, by id. Used
 * by fleet costs (fuel loads, maintenance) to point at the invoice that books
 * them.
 */
export function PurchaseInvoiceLinkPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query.trim(), 200);

  const linked = usePurchaseInvoiceByIdOptional(value);
  const search = usePurchaseInvoicesSearch(
    {
      query: debouncedQuery,
      supplierId: null,
      channelId: null,
      kind: "factura",
      excludeId: null,
      status: "received",
      limit: RESULT_LIMIT,
    },
    { enabled: open && !value },
  );
  const results = search.data?.invoices ?? [];

  if (value) {
    const inv = linked.data;
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">
            {inv ? formatInvoiceNumber(inv) : "Factura vinculada"}
          </p>
          {inv && (
            <p className="truncate text-xs text-muted-foreground">
              {invoiceSummary(inv)}
            </p>
          )}
          {linked.isError && (
            <p className="text-xs text-muted-foreground">
              No se pudo cargar la factura.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Quitar factura de compra"
          onClick={() => onChange(null)}
          disabled={disabled}
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
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número o proveedor"
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
        {search.isFetching ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            Buscando…
          </p>
        ) : search.isError ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            No se pudo buscar facturas.
          </p>
        ) : results.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            Sin facturas de compra recibidas.
          </p>
        ) : (
          <ul className="max-h-[320px] overflow-y-auto py-1">
            {results.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(inv.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono font-medium">
                      {formatInvoiceNumber(inv)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {invoiceSummary(inv)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
