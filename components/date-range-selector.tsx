"use client";

import { Calendar as CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange as RDPDateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDateRange } from "@/components/providers/date-range-provider";
import {
  RANGE_PRESET_LABEL,
  RANGE_PRESET_OPTIONS,
  type RangePreset,
} from "@/lib/date-range";

function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/**
 * Selector global de rango de fechas. Trigger compacto en el toolbar de
 * cada tabla; al abrir muestra los 4 presets como botones en fila +
 * calendar de rango cuando elegís "Personalizado".
 *
 * Mantiene state local de UI (`draftPreset`, `draftRange`) que solo
 * commitea al context global cuando hay un rango efectivo (preset
 * fijo → al instante; custom → cuando el calendar tiene from + to).
 * Esto evita el flicker "muestra todo" cuando el usuario abre custom
 * pero todavía no terminó de seleccionar fechas.
 */
export function DateRangeSelector() {
  const { preset, customFrom, customTo, setPreset, setCustom } = useDateRange();
  const [open, setOpen] = useState(false);

  const [draftPreset, setDraftPreset] = useState<RangePreset>(preset);
  const [draftRange, setDraftRange] = useState<RDPDateRange | undefined>(
    customFrom && customTo
      ? { from: isoToDate(customFrom), to: isoToDate(customTo) }
      : undefined,
  );

  useEffect(() => {
    setDraftPreset(preset);
    if (preset === "custom" && customFrom && customTo) {
      setDraftRange({
        from: isoToDate(customFrom),
        to: isoToDate(customTo),
      });
    }
  }, [preset, customFrom, customTo]);

  const isCustom = preset === "custom";
  const triggerLabel =
    isCustom && customFrom && customTo
      ? `${customFrom} → ${customTo}`
      : RANGE_PRESET_LABEL[preset];

  function onPresetClick(next: RangePreset) {
    setDraftPreset(next);
    if (next !== "custom") {
      setPreset(next);
      setOpen(false);
    }
    // Custom: el popover sigue abierto, mostramos el calendar.
  }

  function onRangeSelect(r: RDPDateRange | undefined) {
    setDraftRange(r);
    if (r?.from && r?.to) {
      setCustom(dateToIso(r.from), dateToIso(r.to));
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarIcon className="size-4" />
          <span className="font-normal">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3"
        align="start"
        sideOffset={4}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {RANGE_PRESET_OPTIONS.map((o) => {
              const active = draftPreset === o.value;
              return (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => onPresetClick(o.value)}
                >
                  {o.label}
                </Button>
              );
            })}
          </div>
          {draftPreset === "custom" && (
            <div className="rounded-md border">
              <Calendar
                mode="range"
                numberOfMonths={1}
                selected={draftRange}
                onSelect={onRangeSelect}
                captionLayout="dropdown"
              />
              <p className="px-3 pb-2 text-[11px] text-muted-foreground">
                Elegí fecha de inicio y fin. Se aplica al seleccionar la
                segunda.
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
