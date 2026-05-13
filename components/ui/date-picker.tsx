"use client";

import { Calendar as CalendarIcon, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateToIso, isoToDate } from "@/lib/date-range";
import { cn } from "@/lib/utils";

function formatDisplay(iso: string): string {
  const d = isoToDate(iso);
  if (!d) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * DatePicker uniforme: trigger compacto con la fecha en formato AR
 * (dd/mm/yyyy) que abre un Calendar de shadcn en un Popover. Reemplaza
 * los `<input type="date">` nativos para que la experiencia sea consistente
 * y soporte navegación rápida por año/mes vía dropdowns.
 *
 * Value e onChange usan strings ISO (`YYYY-MM-DD`) para compatibilidad
 * con los forms existentes.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Elegí fecha",
  disabled,
  className,
  clearable = false,
  id,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            {value ? formatDisplay(value) : placeholder}
          </span>
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpiar fecha"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(dateToIso(d));
              setOpen(false);
            }
          }}
          captionLayout="dropdown"
        />
      </PopoverContent>
    </Popover>
  );
}
