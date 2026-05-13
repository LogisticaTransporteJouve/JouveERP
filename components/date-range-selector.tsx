"use client";

import { Calendar as CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
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
  const [draftFrom, setDraftFrom] = useState<Date | undefined>(
    customFrom ? isoToDate(customFrom) : undefined,
  );
  const [draftTo, setDraftTo] = useState<Date | undefined>(
    customTo ? isoToDate(customTo) : undefined,
  );

  useEffect(() => {
    setDraftPreset(preset);
    if (preset === "custom") {
      setDraftFrom(customFrom ? isoToDate(customFrom) : undefined);
      setDraftTo(customTo ? isoToDate(customTo) : undefined);
    }
  }, [preset, customFrom, customTo]);

  function maybeApply(from: Date | undefined, to: Date | undefined) {
    if (!from || !to) return;
    // Si el usuario eligió "to" antes que "from" (cosa rara), normalizamos.
    const [a, b] = from <= to ? [from, to] : [to, from];
    setCustom(dateToIso(a), dateToIso(b));
    setOpen(false);
  }

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
    // Custom: el popover sigue abierto, mostramos los 2 calendars.
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
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="space-y-1 rounded-md border p-2">
                <Label className="px-1 text-xs">Desde</Label>
                <Calendar
                  mode="single"
                  selected={draftFrom}
                  onSelect={(d) => {
                    setDraftFrom(d);
                    maybeApply(d, draftTo);
                  }}
                  captionLayout="dropdown"
                />
              </div>
              <div className="space-y-1 rounded-md border p-2">
                <Label className="px-1 text-xs">Hasta</Label>
                <Calendar
                  mode="single"
                  selected={draftTo}
                  onSelect={(d) => {
                    setDraftTo(d);
                    maybeApply(draftFrom, d);
                  }}
                  captionLayout="dropdown"
                  disabled={draftFrom ? { before: draftFrom } : undefined}
                />
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
