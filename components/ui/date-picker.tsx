"use client";

import { Calendar as CalendarIcon } from "lucide-react";
import { useState } from "react";
import type { Matcher } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PickerTrigger,
  type PickerFieldProps,
} from "@/components/ui/picker-trigger";
import { dateToIso, isoToDate } from "@/lib/date-range";

function formatDisplay(iso: string): string {
  const d = isoToDate(iso);
  if (!d) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function clamp(d: Date, min?: Date, max?: Date): Date {
  if (min && d < min) return min;
  if (max && d > max) return max;
  return d;
}

/**
 * Uniform DatePicker: a compact trigger showing the date in AR format
 * (dd/mm/yyyy) that opens the Spanish shadcn Calendar inside a Popover. It
 * replaces the native date input everywhere (`components/date-inputs.test.ts`
 * keeps it that way), so every date field looks and reads the same.
 *
 * Value and onChange use ISO strings (`YYYY-MM-DD`, `""` when empty), the
 * native input's format, so forms and schemas read it unchanged. `min` and
 * `max` (also `YYYY-MM-DD`) disable the days outside the range.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Elegí fecha",
  clearable = false,
  ...field
}: PickerFieldProps & {
  value: string | null | undefined;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  const iso = value ?? "";
  const selected = isoToDate(iso);
  const minDate = min ? isoToDate(min) : undefined;
  const maxDate = max ? isoToDate(max) : undefined;
  const outside: Matcher[] = [];
  if (minDate) outside.push({ before: minDate });
  if (maxDate) outside.push({ after: maxDate });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          {...field}
          icon={CalendarIcon}
          display={formatDisplay(iso)}
          placeholder={placeholder}
          clearLabel="Limpiar fecha"
          onClear={clearable ? () => onChange("") : undefined}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={selected ?? clamp(new Date(), minDate, maxDate)}
          startMonth={minDate}
          endMonth={maxDate}
          disabled={outside}
          onSelect={(d) => {
            if (d) onChange(dateToIso(d));
            setOpen(false);
          }}
          captionLayout="dropdown"
        />
      </PopoverContent>
    </Popover>
  );
}
