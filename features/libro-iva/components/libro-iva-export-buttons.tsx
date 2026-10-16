"use client";

import { FileDown, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadFromUrl } from "@/lib/export/download";

/** PDF and Excel downloads of one libro IVA period. */
export function LibroIvaExportButtons({
  book,
  period,
  channelId,
}: {
  book: "ventas" | "compras";
  period: string;
  channelId: string | null | undefined;
}) {
  const [downloading, setDownloading] = useState(false);
  const qs = new URLSearchParams({ period });
  if (channelId) qs.set("channel", channelId);
  const base = `/api/accounting/libro-iva-${book}`;

  async function exportXlsx() {
    setDownloading(true);
    try {
      await downloadFromUrl(
        `${base}/xlsx?${qs.toString()}`,
        `libro-iva-${book}-${period}.xlsx`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo generar el Excel.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex justify-end gap-2">
      <Button asChild variant="outline" size="sm">
        <a
          href={`${base}/pdf?${qs.toString()}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileDown />
          Exportar PDF
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={downloading}
        onClick={exportXlsx}
      >
        <FileSpreadsheet />
        {downloading ? "Generando…" : "Exportar Excel"}
      </Button>
    </div>
  );
}
