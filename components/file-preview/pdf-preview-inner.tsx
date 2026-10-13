"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker bundled by Next as a static asset (CSP-friendly — `script-src
// 'self'` rejects the CDN variant). Mirrors features/invoices/components/
// pdf-viewer-inner.tsx.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_PAGES_RENDERED = 10;

export function PdfPreviewInner({ url }: { url: string }) {
  const [pages, setPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (loadError) {
    return (
      <p className="rounded-md bg-card p-6 text-center text-sm text-destructive shadow-2xl">
        No se pudo cargar el PDF: {loadError}
      </p>
    );
  }

  const visiblePages = Math.min(pages, MAX_PAGES_RENDERED);

  return (
    <Document
      suspense={false}
      file={url}
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
