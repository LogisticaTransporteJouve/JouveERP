"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Opens a date-range dialog and exports the given resource to PDF via
 * /api/export/<resource>. Defaults to the current month (the common "send the
 * monthly statement" case); "Todo el historial" exports with no date filter.
 * `params` are extra query params the exporter needs (e.g. clientId, name).
 */
export function ExportPdfButton({
  resource,
  params = {},
  label = "Exportar PDF",
}: {
  resource: string;
  params?: Record<string, string>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  function exportPdf(rangeFrom: string, rangeTo: string) {
    const qs = new URLSearchParams(params);
    if (rangeFrom) qs.set("from", rangeFrom);
    if (rangeTo) qs.set("to", rangeTo);
    window.open(`/api/export/${resource}?${qs.toString()}`, "_blank");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar a PDF</DialogTitle>
          <DialogDescription>
            Elegí el rango de fechas para el reporte. También podés exportar todo
            el historial.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Desde</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Hasta</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => exportPdf("", "")}>
            Todo el historial
          </Button>
          <Button onClick={() => exportPdf(from, to)}>
            <Download />
            Descargar período
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
