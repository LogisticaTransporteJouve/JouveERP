"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Use the worker bundled by Next as a static asset. The CDN approach trips
// our CSP (`script-src 'self'`); this URL stays on our origin.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Inner viewer that imports react-pdf. Kept in a separate module so the
// wrapper Dialog can `dynamic(..., { ssr: false })` it — pdfjs-dist relies
// on browser-only globals (DOMMatrix, OffscreenCanvas) that crash the
// Next.js server pass otherwise.
//
// The fiscal PDF ships ORIGINAL + DUPLICADO. The viewer only shows the
// first page (ORIGINAL) on purpose — that's what the user reads. The
// downloaded PDF still includes both pages so the printed copy is
// AFIP-compliant.
export function PdfViewerInner({
  id,
  maxPages = 1,
}: {
  id: string;
  maxPages?: number;
}) {
  const [pages, setPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (loadError) {
    return (
      <p className="py-12 text-center text-sm text-destructive">
        No se pudo cargar el PDF: {loadError}
      </p>
    );
  }

  const visiblePages = Math.min(pages, maxPages);

  return (
    <Document
      file={`/api/invoices/${id}/pdf`}
      onLoadSuccess={({ numPages }) => {
        setPages(numPages);
        setLoadError(null);
      }}
      onLoadError={(err) => setLoadError(err.message)}
      loading={
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando PDF…
        </div>
      }
      className="flex flex-col items-center gap-4"
    >
      {Array.from({ length: visiblePages }, (_, i) => (
        <Page
          key={i}
          pageNumber={i + 1}
          width={760}
          className="overflow-hidden rounded-md shadow-2xl"
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      ))}
    </Document>
  );
}
