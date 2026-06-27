"use client";

import { Download, ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isImage, isPdf } from "@/lib/files/preview";
import { cn } from "@/lib/utils";

type FilePreviewSurfaceProps = {
  url: string | null;
  filename: string;
  mimeType: string | null;
  /** True while the signed URL is still being generated. */
  isLoading?: boolean;
  className?: string;
};

/**
 * Inline document preview that fills its container (PDF via native iframe,
 * images via <img>, everything else a download/open card). Unlike
 * FilePreviewSurface's dialog sibling, this renders in place — used as the
 * left pane of the document review sheet (file on the left, data on the right).
 */
export function FilePreviewSurface({
  url,
  filename,
  mimeType,
  isLoading,
  className,
}: FilePreviewSurfaceProps) {
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

  if (isPdf(mimeType)) {
    return (
      <iframe
        src={url}
        title={filename}
        className={cn("h-full w-full border-0 bg-muted", className)}
      />
    );
  }

  if (isImage(mimeType)) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center overflow-auto bg-muted p-2",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={filename}
          className="max-h-full max-w-full object-contain"
        />
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
