"use client";

import { Calendar as CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateToIso, isoToDate } from "@/lib/date-range";
import { formatArgentineDate } from "@/lib/format";
import {
  ALL_DATES_LABEL,
  PERIOD_PRESETS,
  PERIOD_PRESET_LABEL,
  type PeriodPreset,
  type PeriodSelection,
} from "@/lib/list-period";

function triggerLabel(value: PeriodSelection): string {
  if (value.preset === null) return ALL_DATES_LABEL;
  if (value.preset === "custom" && value.from && value.to) {
    return `${formatArgentineDate(value.from)} → ${formatArgentineDate(value.to)}`;
  }
  return PERIOD_PRESET_LABEL[value.preset];
}

/**
 * Date-period filter of a document list: presets (hoy, ayer, esta semana,
 * este mes, mes anterior) or a custom range picked on two calendars. A custom
 * range is only committed once both dates are picked.
 */
export function PeriodFilter({
  value,
  onChange,
}: {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(value.preset === "custom");
  const [draftFrom, setDraftFrom] = useState<Date | undefined>(
    value.from ? isoToDate(value.from) : undefined,
  );
  const [draftTo, setDraftTo] = useState<Date | undefined>(
    value.to ? isoToDate(value.to) : undefined,
  );

  function pick(preset: PeriodPreset | null) {
    if (preset === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange({ preset, from: null, to: null });
    setOpen(false);
  }

  function applyCustom(from: Date, to: Date) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    onChange({ preset: "custom", from: dateToIso(a), to: dateToIso(b) });
    setOpen(false);
  }

  const active: PeriodPreset | null = customOpen ? "custom" : value.preset;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCustomOpen(value.preset === "custom");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <CalendarIcon className="size-4" />
          <span className="font-normal">{triggerLabel(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[calc(100vw-2rem)] p-3"
        align="start"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={active === null ? "default" : "outline"}
              onClick={() => pick(null)}
            >
              {ALL_DATES_LABEL}
            </Button>
            {PERIOD_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={active === preset ? "default" : "outline"}
                onClick={() => pick(preset)}
              >
                {PERIOD_PRESET_LABEL[preset]}
              </Button>
            ))}
          </div>
          {customOpen && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="space-y-1 rounded-md border p-2">
                <Label className="px-1 text-xs">Desde</Label>
                <Calendar
                  mode="single"
                  selected={draftFrom}
                  onSelect={(d) => {
                    setDraftFrom(d);
                    if (d && draftTo && draftTo < d) setDraftTo(undefined);
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
                    if (d && draftFrom) applyCustom(draftFrom, d);
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

/** Shown instead of an empty table when the period hides every row the view
 *  has: never leave a balance without the movements behind it. */
export function PeriodEmptyNotice({
  total,
  onShowAll,
}: {
  /** Rows outside the period. */
  total: number;
  onShowAll: () => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-2">
      No hay movimientos en el período elegido ({total} en total).
      <Button type="button" variant="outline" size="sm" onClick={onShowAll}>
        Ver todo
      </Button>
    </span>
  );
}
