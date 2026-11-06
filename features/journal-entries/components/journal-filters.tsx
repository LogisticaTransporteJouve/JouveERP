"use client";

import { CalendarRange } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/month-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  currentPeriod,
  isKnownSource,
  JOURNAL_SOURCE_TABLES,
  SOURCE_LABEL,
  type JournalFilters,
  type JournalSourceTable,
} from "../schema";

type Props = {
  filters: JournalFilters;
  onChange: (next: JournalFilters) => void;
  channels: ReadonlyArray<{ id: string; name: string }>;
};

const SOURCE_OPTIONS: Array<{
  value: JournalSourceTable | "all";
  label: string;
}> = [
  { value: "all", label: "Todos los orígenes" },
  ...JOURNAL_SOURCE_TABLES.map((value) => ({
    value,
    label: SOURCE_LABEL[value],
  })),
];

const NO_CHANNEL = "__all";

export function JournalFiltersBar({ filters, onChange, channels }: Props) {
  const period = filters.period ?? "";
  const source = filters.sourceTable ?? "all";
  const channelId = filters.channelId ?? NO_CHANNEL;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          Período (YYYY-MM)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            value={period}
            onChange={(value) =>
              onChange({ ...filters, period: value || null })
            }
            className="w-[160px]"
            clearable
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...filters, period: currentPeriod() })}
            title="Mes actual"
          >
            <CalendarRange className="size-4" />
            Hoy
          </Button>
          {period && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...filters, period: null })}
            >
              Limpiar
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Origen</label>
        <Select
          value={source}
          onValueChange={(v) =>
            onChange({
              ...filters,
              sourceTable: isKnownSource(v) ? v : "all",
            })
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Canal</label>
        <Select
          value={channelId}
          onValueChange={(v) =>
            onChange({ ...filters, channelId: v === NO_CHANNEL ? null : v })
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CHANNEL}>Todos los canales</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
