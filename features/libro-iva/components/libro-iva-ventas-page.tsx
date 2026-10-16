"use client";

import { Suspense, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { ExportTxtButton } from "./export-txt-button";
import { LibroIvaVentasTable } from "./libro-iva-ventas-table";

const ALL = "__all";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function LibroIvaVentasPageContent({
  channels,
}: {
  channels: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [period, setPeriod] = useState(currentPeriod());
  const [channelId, setChannelId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Libro IVA Ventas
        </h1>
        <p className="text-sm text-muted-foreground">
          Comprobantes emitidos fiscales del período, agrupados por alícuota (RG
          1361), en pesos: los comprobantes en moneda extranjera se convierten
          con la cotización informada a AFIP. Solo se listan canales fiscales —
          los internos no van al libro IVA.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Período</label>
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value || currentPeriod())}
            className="w-[180px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Canal fiscal</label>
          <Select
            value={channelId ?? ALL}
            onValueChange={(v) => setChannelId(v === ALL ? null : v)}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los canales fiscales</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ExportTxtButton period={period} book="ventas" />
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <LibroIvaVentasTable period={period} channelId={channelId} />
      </Suspense>
    </div>
  );
}
