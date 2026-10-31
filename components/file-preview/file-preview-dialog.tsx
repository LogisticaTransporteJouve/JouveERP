"use client";

import { Download, ExternalLink, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { isImage, isPdf } from "@/lib/files/preview";

// react-pdf + pdfjs-dist need browser globals (DOMMatrix, OffscreenCanvas).
// `ssr: false` keeps it out of the server pass and only loads when the user
// opens a PDF preview. Same pattern as features/invoices/components/
// pdf-viewer-dialog.tsx.
const PdfPreviewInner = dynamic(
  () =>
    import("./pdf-preview-inner").then((m) => ({ default: m.PdfPreviewInner })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-white/80">
        <Loader2 className="size-4 animate-spin" />
        Cargando visor…
      </div>
    ),
  },
);

type FilePreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  filename: string;
  mimeType: string | null;
};

export function FilePreviewDialog({
  open,
  onOpenChange,
  url,
  filename,
  mimeType,
}: FilePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto border-0 bg-transparent p-0 shadow-none sm:max-w-none w-fit"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{filename}</DialogTitle>
        <DialogDescription className="sr-only">
          Vista previa de {filename}.
        </DialogDescription>

        {!url ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-white/80">
            <Loader2 className="size-4 animate-spin" />
            Generando URL…
          </div>
        ) : (
          <PreviewContent url={url} filename={filename} mimeType={mimeType} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewContent({
  url,
  filename,
  mimeType,
}: {
  url: string;
  filename: string;
  mimeType: string | null;
}) {
  if (isPdf(mimeType)) {
    return <PdfPreviewInner url={url} />;
  }

  if (isImage(mimeType)) {
    return (
      // A short-lived signed storage URL of unknown size: next/image would
      // need remotePatterns and fixed dimensions, and gains nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={filename}
        className="max-h-[88vh] max-w-[92vw] rounded-md shadow-2xl"
      />
    );
  }

  // Non-renderable types: offer download + open in a new tab. Spreadsheet
  // preview (SheetJS-based) is intentionally not in K.10 — see roadmap §4.1.
  return (
    <div className="flex flex-col items-center gap-3 rounded-md bg-card p-8 text-sm shadow-2xl">
      <p className="text-muted-foreground">
        Vista previa no disponible para este tipo de archivo.
      </p>
      <div className="flex gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            Abrir
          </a>
        </Button>
        <Button asChild size="sm">
          <a href={url} download={filename}>
            <Download className="size-4" />
            Descargar
          </a>
        </Button>
      </div>
    </div>
  );
}
