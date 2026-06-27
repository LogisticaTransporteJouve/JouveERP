"use client";

import {
  Download,
  ExternalLink,
  Loader2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
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
 * Inline document preview that fills its container, with a floating toolbar
 * (open / download always; zoom for images). PDFs use the browser's native
 * viewer (its own zoom/print/download). Used as the left pane of the document
 * review sheet — file on the left, data on the right.
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

  const fileActions = (
    <>
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="size-7"
        title="Abrir en otra pestaña"
      >
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-4" />
          <span className="sr-only">Abrir</span>
        </a>
      </Button>
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="size-7"
        title="Descargar"
      >
        <a href={url} download={filename}>
          <Download className="size-4" />
          <span className="sr-only">Descargar</span>
        </a>
      </Button>
    </>
  );

  if (isPdf(mimeType)) {
    return (
      <div className={cn("relative h-full", className)}>
        <Toolbar>{fileActions}</Toolbar>
        <iframe
          src={url}
          title={filename}
          className="h-full w-full border-0 bg-muted"
        />
      </div>
    );
  }

  if (isImage(mimeType)) {
    return (
      <div className={cn("relative h-full", className)}>
        <Toolbar>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Alejar"
            disabled={scale <= MIN_SCALE}
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - STEP))}
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Restablecer zoom"
            disabled={scale === 1}
            onClick={() => setScale(1)}
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Acercar"
            disabled={scale >= MAX_SCALE}
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + STEP))}
          >
            <ZoomIn className="size-4" />
          </Button>
          {fileActions}
        </Toolbar>
        <div className="flex h-full items-center justify-center overflow-auto p-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={filename}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "center center",
            }}
            className="max-h-full max-w-full rounded object-contain shadow-md transition-transform"
          />
        </div>
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

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background/90 pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border p-0.5 shadow-sm backdrop-blur">
      {children}
    </div>
  );
}
