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
  dateToIso,
  isoToDate,
  RANGE_PRESET_LABEL,
  RANGE_PRESET_OPTIONS,
  type RangePreset,
} from "@/lib/date-range";

/**
 * Global date-range selector. A compact trigger in each table's toolbar;
 * when opened it shows the 4 presets as buttons in a row + a range
 * calendar when you pick "Custom".
 *
 * It keeps local UI state (`draftPreset`, `draftRange`) that is only
 * committed to the global context when there's an effective range (fixed
 * preset → immediately; custom → when the calendar has both from + to).
 * This avoids the "show everything" flicker when the user opens custom
 * but hasn't finished selecting the dates yet.
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
    // If the user picked "to" before "from" (an odd case), we normalize.
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
    // Custom: the popover stays open, we show the 2 calendars.
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
                    // Picking a new start invalidates a previously-chosen
                    // end if it'd be before — and we don't auto-apply on
                    // start click, so the user can keep picking the end.
                    setDraftFrom(d);
                    if (d && draftTo && draftTo < d) {
                      setDraftTo(undefined);
                    }
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
                    // Only close+apply once both are selected.
                    if (d && draftFrom) maybeApply(draftFrom, d);
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
