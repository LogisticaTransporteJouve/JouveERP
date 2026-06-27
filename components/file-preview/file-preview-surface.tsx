"use client";

import { Download, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { isImage, isPdf } from "@/lib/files/preview";
import { cn } from "@/lib/utils";

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const STEP = 0.25;

type FilePreviewSurfaceProps = {
  url: string | null;
  filename: string;
  mimeType: string | null;
  /** True while the signed URL is still being generated. */
  isLoading?: boolean;
  className?: string;
};

/**
 * Inline document preview: the document fills the area, a floating control pill
 * sits BELOW it (zoom for images + a labelled download) so it never overlaps the
 * content. PDFs use the browser's native viewer. Used as the floating left pane
 * of the document review sheet.
 */
export function FilePreviewSurface({
  url,
  filename,
  mimeType,
  isLoading,
  className,
}: FilePreviewSurfaceProps) {
  const [scale, setScale] = useState(1);

  if (isLoading || !url) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex h-full items-center justify-center gap-2 text-sm",
          className,
        )}
      >
        <Loader2 className="size-4 animate-spin" />
        Cargando archivo…
      </div>
    );
  }

  const downloadButton = (
    <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
      <a href={url} download={filename}>
        <Download className="size-4" />
        Descargar
      </a>
    </Button>
  );

  if (isPdf(mimeType)) {
    return (
      <div className={cn("flex h-full flex-col gap-3", className)}>
        <iframe
          src={url}
          title={filename}
          className="min-h-0 w-full flex-1 rounded-lg border-0"
        />
        <Toolbar>{downloadButton}</Toolbar>
      </div>
    );
  }

  if (isImage(mimeType)) {
    return (
      <div className={cn("flex h-full flex-col gap-3", className)}>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={filename}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "center center",
            }}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform"
          />
        </div>
        <Toolbar>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Alejar"
            disabled={scale <= MIN_SCALE}
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - STEP))}
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Acercar"
            disabled={scale >= MAX_SCALE}
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + STEP))}
          >
            <ZoomIn className="size-4" />
          </Button>
          {downloadButton}
        </Toolbar>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm",
        className,
      )}
    >
      <p className="text-muted-foreground">
        Vista previa no disponible para este tipo de archivo.
      </p>
      <Button asChild variant="secondary" size="sm" className="gap-1.5">
        <a href={url} download={filename}>
          <Download className="size-4" />
          Descargar
        </a>
      </Button>
    </div>
  );
}

/** A light floating control pill, centered below the document. */
function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 justify-center">
      <div className="bg-card flex items-center gap-1 rounded-full border px-1.5 py-1 shadow-lg">
        {children}
      </div>
    </div>
  );
}
