"use client";

import { FileText } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface InvoiceOption {
  id: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number | null;
  fecha: string;
  status: string;
  channel_id: string;
  imp_total: number | string;
}

export function PreviewPdfPanel({
  comprobantes,
}: {
  comprobantes: InvoiceOption[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    comprobantes[0]?.id ?? null,
  );

  const selected = useMemo(
    () => comprobantes.find((c) => c.id === selectedId) ?? null,
    [comprobantes, selectedId],
  );

  const previewSrc = selected
    ? `/api/invoices/${selected.id}/pdf?preview=1`
    : null;

  if (comprobantes.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No hay comprobantes en la base. Emití uno desde{" "}
        <code className="font-mono">/comprobantes</code> para previsualizar.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <Select
            value={selectedId ?? undefined}
            onValueChange={(v) => setSelectedId(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Elegí un comprobante" />
            </SelectTrigger>
            <SelectContent position="popper">
              {comprobantes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {labelFor(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {previewSrc && (
          <Button
            type="button"
            variant="outline"
            asChild
            aria-label="Abrir en pestaña nueva"
          >
            <a href={previewSrc} target="_blank" rel="noopener noreferrer">
              <FileText />
              Abrir
            </a>
          </Button>
        )}
      </div>

      {previewSrc && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <iframe
            key={previewSrc}
            src={previewSrc}
            title="Preview del comprobante"
            className="h-[820px] w-full border-0"
          />
        </div>
      )}
    </div>
  );
}

function labelFor(c: InvoiceOption): string {
  const numero =
    c.numero == null
      ? `${String(c.punto_venta).padStart(5, "0")}-—`
      : `${String(c.punto_venta).padStart(5, "0")}-${String(c.numero).padStart(8, "0")}`;
  const letter = c.letter ? `${c.kind} ${c.letter}` : c.kind;
  return `${numero} · ${letter} · ${c.fecha} · ${c.status}`;
}
