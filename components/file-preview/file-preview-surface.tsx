"use client";

import { Download, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { isImage, isPdf } from "@/lib/files/preview";
import { cn } from "@/lib/utils";

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const STEP = 0.25;

const TOOL_BTN =
  "size-8 text-background hover:bg-background/20 hover:text-background";

type FilePreviewSurfaceProps = {
  url: string | null;
  filename: string;
  mimeType: string | null;
  /** True while the signed URL is still being generated. */
  isLoading?: boolean;
  className?: string;
};

/**
 * Inline document preview that fills its container, with a dark floating bottom
 * toolbar (zoom for images + a labelled download). PDFs use the browser's
 * native viewer. Used as the floating left pane of the document review sheet —
 * document on the left, data on the right.
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
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-background hover:bg-background/20 hover:text-background"
    >
      <a href={url} download={filename}>
        <Download className="size-4" />
        Descargar
      </a>
    </Button>
  );

  if (isPdf(mimeType)) {
    return (
      <div className={cn("relative h-full", className)}>
        <iframe
          src={url}
          title={filename}
          className="h-full w-full rounded-lg border-0"
        />
        <Toolbar>{downloadButton}</Toolbar>
      </div>
    );
  }

  if (isImage(mimeType)) {
    return (
      <div className={cn("relative h-full", className)}>
        <div className="flex h-full items-center justify-center overflow-auto">
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
            className={TOOL_BTN}
            title="Alejar"
            disabled={scale <= MIN_SCALE}
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - STEP))}
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={TOOL_BTN}
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

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-foreground/90 pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full px-1.5 py-1 shadow-lg backdrop-blur">
      {children}
    </div>
  );
}
