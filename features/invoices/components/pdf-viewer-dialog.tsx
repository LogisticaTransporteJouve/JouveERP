"use client";

import { FileText, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// react-pdf + pdfjs-dist need browser globals (DOMMatrix, OffscreenCanvas).
// `ssr: false` keeps the bundle out of the server pass and only loads it
// when the user opens the viewer for the first time.
const PdfViewerInner = dynamic(
  () =>
    import("./pdf-viewer-inner").then((m) => ({ default: m.PdfViewerInner })),
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

export function PdfViewerDialog({
  id,
  label,
  kind = "invoice",
}: {
  id: string;
  label: string;
  kind?: "invoice" | "receipt";
}) {
  const [open, setOpen] = useState(false);
  const url =
    kind === "receipt" ? `/api/receipts/${id}/pdf` : `/api/invoices/${id}/pdf`;
  // Invoices ship ORIGINAL + DUPLICADO; only ORIGINAL is shown in the
  // preview. Receipts can paginate when there are many allocations — show
  // up to 20 pages.
  const maxPages = kind === "receipt" ? 20 : 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Ver PDF">
          <FileText className="size-4" />
        </Button>
      </DialogTrigger>
      {/* "Floating" look: no border / background / padding on the dialog —
          the PDF page renders its own shadow against the dim overlay so
          the only visible thing is the document. */}
      <DialogContent
        className="border-0 bg-transparent p-0 shadow-none sm:max-w-none w-fit"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">
          Vista previa {kind === "receipt" ? "del recibo" : "del comprobante"}{" "}
          {label}.
        </DialogDescription>
        {open && <PdfViewerInner url={url} maxPages={maxPages} />}
      </DialogContent>
    </Dialog>
  );
}
