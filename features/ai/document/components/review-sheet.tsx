"use client";

import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { FilePreviewSurface } from "@/components/file-preview/file-preview-surface";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSignedUrl } from "@/features/files/hooks/use-attachments";

import { useExtraction } from "../hooks/use-documents";
import {
  CONFIDENCE_CONFIG,
  DOCUMENT_TYPE_DESCRIPTIONS,
  confidenceBand,
  documentTypeLabel,
  statusConfig,
} from "../lib/document-config";

import { DocumentDetail } from "./detail/document-detail";
import { ReviewActions } from "./review-actions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchInfo(matches: unknown): { name?: string; duplicate: boolean } {
  if (!isRecord(matches)) return { duplicate: false };
  const name =
    typeof matches.supplier_name === "string"
      ? matches.supplier_name
      : typeof matches.client_name === "string"
        ? matches.client_name
        : undefined;
  return { name, duplicate: typeof matches.duplicate_of === "string" };
}

type PreviewState = {
  url: string | null;
  filename: string;
  mimeType: string | null;
  loading: boolean;
};

/**
 * Side-by-side review surface: the source document on the left, the full
 * extracted detail + create actions on the right (the JouveERP analogue of
 * Sumary's AnomaliesRowSheet). A wide centered Dialog keeps the project's
 * Dialog-over-Sheet convention while delivering the two-pane layout.
 */
export function ReviewSheet({
  extractionId,
  onOpenChange,
}: {
  extractionId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useExtraction(extractionId);
  const data = detail.data;
  const fileId = data?.file_id;
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!fileId) {
      setPreview(null);
      return;
    }
    setPreview({
      url: null,
      filename: data?.file?.original_filename ?? "documento",
      mimeType: data?.file?.mime_type ?? null,
      loading: true,
    });
    fetchSignedUrl(fileId)
      .then((signed) => {
        if (cancelled) return;
        setPreview({
          url: signed.url,
          filename: signed.filename,
          mimeType: signed.mimeType,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPreview((p) => (p ? { ...p, loading: false } : null));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, data?.file?.original_filename, data?.file?.mime_type]);

  const kind = data?.detected_type ?? null;
  const band = confidenceBand(data?.confidence ?? null);
  const status = statusConfig(data?.status ?? "pending_review");
  const StatusIcon = status.icon;
  const match = matchInfo(data?.matches);

  return (
    <Dialog open={extractionId !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton
      >
        <DialogHeader className="space-y-1 border-b px-4 py-3 text-left">
          <DialogTitle className="truncate text-base">
            {data?.file?.original_filename ?? "Documento"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Revisión del documento escaneado y sus datos extraídos.
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2">
            {kind && (
              <Badge
                variant="outline"
                className="gap-1"
                title={DOCUMENT_TYPE_DESCRIPTIONS[kind]}
              >
                <Sparkles className="size-3" />
                {documentTypeLabel(kind)}
              </Badge>
            )}
            {band && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                {(() => {
                  const Icon = CONFIDENCE_CONFIG[band].icon;
                  return <Icon className="size-3" />;
                })()}
                Confianza {CONFIDENCE_CONFIG[band].label}
                {data?.confidence != null
                  ? ` · ${Math.round(data.confidence * 100)}%`
                  : ""}
              </span>
            )}
            <span
              className={`flex items-center gap-1 text-xs ${status.className}`}
            >
              <StatusIcon className="size-3" />
              {status.label}
            </span>
            {match.name && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <CheckCircle2 className="size-3" />
                {match.name}
              </span>
            )}
            {match.duplicate && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <AlertTriangle className="size-3" />
                Posible duplicado
              </span>
            )}
          </div>
        </DialogHeader>

        {detail.isLoading ? (
          <div className="flex-1 p-4">
            <Skeleton className="h-full w-full" />
          </div>
        ) : data ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
            <div className="hidden min-h-0 border-r md:block">
              <FilePreviewSurface
                url={preview?.url ?? null}
                filename={preview?.filename ?? "documento"}
                mimeType={preview?.mimeType ?? null}
                isLoading={preview?.loading ?? true}
                className="h-full"
              />
            </div>
            <div className="min-h-0 space-y-4 overflow-y-auto p-4">
              <DocumentDetail payload={data.payload} kind={kind} />
              <ReviewActions
                extraction={data}
                onCreated={() => onOpenChange(false)}
              />
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground flex-1 p-4 text-sm">
            No se pudo cargar la extracción.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
