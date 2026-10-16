"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { downloadFromUrl } from "@/lib/export/download";
import { XLSX_MIME } from "@/lib/export/mime";

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

type ExportFormat = "pdf" | "xlsx";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Excel" },
];

/**
 * Opens a date-range dialog and exports the given resource to PDF or Excel
 * via /api/export/<resource>. Defaults to the current month (the common "send
 * the monthly statement" case); "Todo el historial" exports with no date
 * filter. `params` are extra query params the exporter needs (e.g. clientId,
 * name).
 */
export function ExportButton({
  resource,
  params = {},
  label = "Exportar",
}: {
  resource: string;
  params?: Record<string, string>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [downloading, setDownloading] = useState(false);

  async function exportRange(rangeFrom: string, rangeTo: string) {
    const qs = new URLSearchParams(params);
    if (rangeFrom) qs.set("from", rangeFrom);
    if (rangeTo) qs.set("to", rangeTo);
    if (format === "pdf") {
      window.open(`/api/export/${resource}?${qs.toString()}`, "_blank");
      setOpen(false);
      return;
    }
    qs.set("format", "xlsx");
    setDownloading(true);
    try {
      await downloadFromUrl(
        `/api/export/${resource}?${qs.toString()}`,
        `${resource}.xlsx`,
        XLSX_MIME,
      );
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo generar el Excel.",
      );
    } finally {
      setDownloading(false);
    }
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
          <DialogTitle>Exportar</DialogTitle>
          <DialogDescription>
            Elegí el formato y el rango de fechas. También podés exportar todo
            el historial.
          </DialogDescription>
        </DialogHeader>
        <div
          role="radiogroup"
          aria-label="Formato"
          className="grid grid-cols-2 gap-2"
        >
          {FORMATS.map((f) => (
            <Button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={format === f.value}
              variant={format === f.value ? "default" : "outline"}
              onClick={() => setFormat(f.value)}
            >
              {f.value === "pdf" ? <FileText /> : <FileSpreadsheet />}
              {f.label}
            </Button>
          ))}
        </div>
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
          <Button
            variant="outline"
            disabled={downloading}
            onClick={() => exportRange("", "")}
          >
            Todo el historial
          </Button>
          <Button disabled={downloading} onClick={() => exportRange(from, to)}>
            <Download />
            {downloading ? "Generando…" : "Descargar período"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
