"use client";

import { CalendarRange } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  currentPeriod,
  SOURCE_LABEL,
  type JournalFilters,
  type JournalSourceTable,
} from "../schema";

type Props = {
  filters: JournalFilters;
  onChange: (next: JournalFilters) => void;
  channels: ReadonlyArray<{ id: string; name: string }>;
};

const SOURCE_OPTIONS: Array<{ value: JournalSourceTable | "all"; label: string }> = [
  { value: "all", label: "Todos los orígenes" },
  { value: "transactions", label: SOURCE_LABEL.transactions },
  { value: "invoices", label: SOURCE_LABEL.invoices },
  { value: "receipts", label: SOURCE_LABEL.receipts },
  { value: "payment_orders", label: SOURCE_LABEL.payment_orders },
];

const NO_CHANNEL = "__all";

export function JournalFiltersBar({ filters, onChange, channels }: Props) {
  const period = filters.period ?? "";
  const source = filters.sourceTable ?? "all";
  const channelId = filters.channelId ?? NO_CHANNEL;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Período (YYYY-MM)</label>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={period}
            onChange={(e) => onChange({ ...filters, period: e.target.value || null })}
            className="w-[160px]"
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
              sourceTable: (v === "all" ? "all" : (v as JournalSourceTable)),
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
