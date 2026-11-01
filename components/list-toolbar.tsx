"use client";

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The one filter bar of every list screen. Left, in this order: the search
 * box, the date period, the list's own filters, and "Limpiar" while any
 * filter is active. Right: the view toggle (when the list has one), Exportar
 * and the create button. Pages put none of these in their header.
 */
export function ListToolbar({
  children,
  actions,
  isFiltered = false,
  onClear,
}: {
  /** ListSearch, PeriodFilter and the list's own filters, in that order. */
  children?: ReactNode;
  /** Right side: view toggle, then ExportButton, then the create button. */
  actions?: ReactNode;
  isFiltered?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {isFiltered && onClear && (
        <Button
          type="button"
          variant="ghost"
          onClick={onClear}
          className="text-muted-foreground"
        >
          <X className="size-4" />
          Limpiar
        </Button>
      )}
      {actions && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export function ListSearch({
  value,
  onChange,
  placeholder,
  numeric = false,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Digits only (e.g. a document number). */
  numeric?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full sm:w-80", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        inputMode={numeric ? "numeric" : undefined}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) =>
          onChange(numeric ? e.target.value.replace(/\D/g, "") : e.target.value)
        }
        className="pl-8"
      />
    </div>
  );
}

/** Dims the rows while a new filter's results load, so stale rows never pass
 *  for the filtered ones. */
export function ListPending({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-busy={pending}
      className={cn(
        "transition-opacity",
        pending && "pointer-events-none opacity-50",
      )}
    >
      {children}
    </div>
  );
}
