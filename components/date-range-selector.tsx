"use client";

import { Calendar } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDateRange } from "@/components/providers/date-range-provider";
import {
  RANGE_PRESET_LABEL,
  RANGE_PRESET_OPTIONS,
  type RangePreset,
} from "@/lib/date-range";

/**
 * Selector global de rango de fechas. Vive en el topbar al lado del
 * scope. Cada tabla del dashboard puede leer del context vía
 * `useDateRange()` para filtrar.
 */
export function DateRangeSelector() {
  const { preset, customFrom, customTo, setPreset, setCustom } = useDateRange();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(customFrom);
  const [draftTo, setDraftTo] = useState(customTo);

  const isCustom = preset === "custom";
  const triggerLabel =
    isCustom && customFrom && customTo
      ? `${customFrom} → ${customTo}`
      : RANGE_PRESET_LABEL[preset];

  function applyCustom() {
    if (!draftFrom || !draftTo) return;
    setCustom(draftFrom, draftTo);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Calendar className="size-4" />
          <span className="font-normal">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Período</Label>
            <Select
              value={preset}
              onValueChange={(v) => setPreset(v as RangePreset)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {RANGE_PRESET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Desde</Label>
                  <Input
                    type="date"
                    value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hasta</Label>
                  <Input
                    type="date"
                    value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                  />
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={applyCustom}
                disabled={!draftFrom || !draftTo}
                className="w-full"
              >
                Aplicar rango
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
