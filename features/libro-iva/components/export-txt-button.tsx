"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { useExportLibroIvaTxt } from "../hooks/use-libro-iva";

function download(name: string, content: string) {
  // Content is normalized to ASCII by the builder, so the bytes are valid
  // ANSI (ISO-8859-1) — what ARCA's importer expects.
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Downloads the period's Libro IVA Digital import files (comprobantes +
 * alícuotas, positional TXT) for Portal IVA / IVA Simple.
 */
export function ExportTxtButton({
  period,
  book,
}: {
  period: string;
  book: "ventas" | "compras";
}) {
  const exportMut = useExportLibroIvaTxt();

  function onClick() {
    exportMut.mutate(
      { period, book },
      {
        onSuccess: (data) => {
          if (data.documents === 0) {
            toast.error("No hay comprobantes para exportar en ese período.");
            return;
          }
          for (const f of data.files) download(f.name, f.content);
          toast.success(
            `${data.documents} comprobante(s) exportados en 2 archivos TXT.`,
            {
              // The files carry each voucher's own currency and rate.
              description:
                "Al importarlos en ARCA elegí “Los importes están expresados en la Moneda Original del Comprobante”.",
            },
          );
          for (const w of data.warnings) toast.warning(w);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Button
      variant="outline"
      className="ml-auto"
      onClick={onClick}
      disabled={exportMut.isPending}
    >
      <Download />
      TXT AFIP
    </Button>
  );
}
