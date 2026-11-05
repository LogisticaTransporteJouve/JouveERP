"use client";

import { CalendarDays, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PickerTrigger,
  type PickerFieldProps,
} from "@/components/ui/picker-trigger";
import { todayIsoLocal } from "@/lib/date-range";
import { cn } from "@/lib/utils";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const COLUMNS = 4;

type YearMonth = { year: number; month: number };

function parseMonth(value: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

function toValue({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function clampMonth(
  ym: YearMonth,
  min: YearMonth | null,
  max: YearMonth | null,
): YearMonth {
  if (min && toValue(ym) < toValue(min)) return min;
  if (max && toValue(ym) > toValue(max)) return max;
  return ym;
}

function shortName(month: number): string {
  return (MONTHS[month - 1] ?? "").slice(0, 3);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `YYYY-MM` → «nov 2026». */
export function formatMonthDisplay(value: string): string {
  const parsed = parseMonth(value);
  return parsed ? `${shortName(parsed.month)} ${parsed.year}` : "";
}

/**
 * Month field in Spanish: a trigger like `DatePicker`'s showing «nov 2026»
 * that opens a year switcher over a 4×3 grid of months. It replaces the native
 * month input, which the browser draws in its own language.
 *
 * Value and onChange use the native input's format (`YYYY-MM`, `""` when
 * empty), so callers parse it unchanged. `min` / `max` (`YYYY-MM`) disable the
 * months outside the range. Keyboard: arrows move across months (and years),
 * Re Pág / Av Pág change the year, Inicio / Fin jump to the row's ends.
 */
export function MonthPicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Elegí mes",
  clearable = false,
  ...field
}: PickerFieldProps & {
  value: string | null | undefined;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  const current = value ?? "";
  const selected = parseMonth(current);
  const minMonth = min ? parseMonth(min) : null;
  const maxMonth = max ? parseMonth(max) : null;
  const [todayYear, todayMonth] = todayIsoLocal().split("-").map(Number);
  const thisMonth: YearMonth = {
    year: todayYear ?? 1970,
    month: todayMonth ?? 1,
  };

  // Where the grid opens: the value, else this month kept inside the range.
  const start = selected ?? clampMonth(thisMonth, minMonth, maxMonth);

  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(start.year);
  const [focusMonth, setFocusMonth] = useState(start.month);
  const monthRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function inRange(ym: YearMonth): boolean {
    const v = toValue(ym);
    return (
      (!minMonth || v >= toValue(minMonth)) &&
      (!maxMonth || v <= toValue(maxMonth))
    );
  }

  const canPrevYear = !minMonth || year - 1 >= minMonth.year;
  const canNextYear = !maxMonth || year + 1 <= maxMonth.year;

  function pick(ym: YearMonth) {
    if (!inRange(ym)) return;
    onChange(toValue(ym));
    setOpen(false);
  }

  function moveFocus(ym: YearMonth) {
    if (minMonth && ym.year < minMonth.year) return;
    if (maxMonth && ym.year > maxMonth.year) return;
    setYear(ym.year);
    setFocusMonth(ym.month);
    // The buttons keep their slots across years, so the target exists now.
    monthRefs.current[ym.month - 1]?.focus();
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = year * 12 + focusMonth - 1;
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -COLUMNS,
      ArrowDown: COLUMNS,
      PageUp: -12,
      PageDown: 12,
    };
    let target: number | null = null;
    const delta = deltas[e.key];
    if (delta !== undefined) target = index + delta;
    const col = (focusMonth - 1) % COLUMNS;
    if (e.key === "Home") target = index - col;
    if (e.key === "End") target = index - col + COLUMNS - 1;
    if (target === null) return;
    e.preventDefault();
    moveFocus({ year: Math.floor(target / 12), month: (target % 12) + 1 });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setYear(start.year);
          setFocusMonth(start.month);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <PickerTrigger
          {...field}
          icon={CalendarDays}
          display={formatMonthDisplay(current)}
          placeholder={placeholder}
          clearLabel="Limpiar mes"
          onClear={clearable ? () => onChange("") : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          monthRefs.current[focusMonth - 1]?.focus();
        }}
      >
        <div className="flex items-center justify-between pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Año anterior"
            disabled={!canPrevYear}
            onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="text-sm font-medium" aria-live="polite">
            {year}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Año siguiente"
            disabled={!canNextYear}
            onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
        <div
          role="group"
          aria-label={`Meses de ${year}`}
          className="grid grid-cols-4 gap-1"
          onKeyDown={onGridKeyDown}
        >
          {MONTHS.map((name, i) => {
            const ym = { year, month: i + 1 };
            const isSelected =
              selected?.year === year && selected.month === i + 1;
            const isThisMonth =
              thisMonth.year === year && thisMonth.month === i + 1;
            const enabled = inRange(ym);
            return (
              <Button
                key={name}
                ref={(el) => {
                  monthRefs.current[i] = el;
                }}
                type="button"
                size="sm"
                variant={isSelected ? "default" : "ghost"}
                tabIndex={focusMonth === i + 1 ? 0 : -1}
                aria-label={`${name} de ${year}`}
                aria-pressed={isSelected}
                aria-current={isThisMonth ? "date" : undefined}
                aria-disabled={!enabled || undefined}
                onClick={() => pick(ym)}
                onFocus={() => setFocusMonth(i + 1)}
                className={cn(
                  "h-9 font-normal",
                  isThisMonth && !isSelected && "bg-accent",
                  !enabled && "pointer-events-none opacity-50",
                )}
              >
                {capitalize(shortName(i + 1))}
              </Button>
            );
          })}
        </div>
        {(inRange(thisMonth) || (clearable && current)) && (
          <div className="flex justify-between gap-2 border-t pt-2 mt-2">
            {clearable && current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Limpiar
              </Button>
            ) : (
              <span />
            )}
            {inRange(thisMonth) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => pick(thisMonth)}
              >
                Este mes
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
