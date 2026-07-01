"use client";

import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { FilePreviewSurface } from "@/components/file-preview/file-preview-surface";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

function reconInfo(
  matches: unknown,
): { matched: number; total: number } | null {
  if (!isRecord(matches) || !isRecord(matches.reconciliation)) return null;
  const r = matches.reconciliation;
  const matched = typeof r.matched === "number" ? r.matched : 0;
  const total = typeof r.statement_total === "number" ? r.statement_total : 0;
  if (total === 0) return null;
  return { matched, total };
}

function expenseInfo(
  matches: unknown,
): { account: string; costCenter?: string; confidence?: number } | null {
  if (!isRecord(matches) || !isRecord(matches.expense)) return null;
  const e = matches.expense;
  const code = typeof e.accountCode === "string" ? e.accountCode : null;
  if (!code || code === "UNMAPPED") return null;
  const name = typeof e.accountName === "string" ? e.accountName : null;
  const ccName = typeof e.costCenterName === "string" ? e.costCenterName : null;
  return {
    account: name ? `${code} — ${name}` : code,
    costCenter: ccName ?? undefined,
    confidence: typeof e.confidence === "number" ? e.confidence : undefined,
  };
}

type PreviewState = {
  url: string | null;
  filename: string;
  mimeType: string | null;
  loading: boolean;
};

/**
 * Document review surface (Sumary's AnomaliesRowSheet layout): the extracted
 * data lives in a right-side Sheet (~600px); the source document floats in a
 * sidecar to its left (desktop), with its own zoom/download toolbar at the
 * bottom. On smaller screens only the data Sheet shows.
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

  const open = extractionId !== null;
  // Hide the floating sidecar while a nested action dialog (e.g. create cheques)
  // is open, so the dialog can stay at the default z without the preview
  // overlapping it (and without a z war that breaks its popovers).
  const [nestedOpen, setNestedOpen] = useState(false);
  const kind = data?.detected_type ?? null;
  const band = confidenceBand(data?.confidence ?? null);
  const status = statusConfig(data?.status ?? "pending_review");
  const StatusIcon = status.icon;
  const match = matchInfo(data?.matches);
  const expense = expenseInfo(data?.matches);
  const recon = reconInfo(data?.matches);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Floating document sidecar, to the left of the 600px Sheet (desktop).
          The document floats directly on the dimmed backdrop — no card frame. */}
      {open && !nestedOpen && (
        <div
          data-doc-sidecar
          className="pointer-events-none fixed inset-y-0 left-0 right-[600px] z-[60] hidden items-center justify-center p-8 lg:flex"
        >
          <FilePreviewSurface
            url={preview?.url ?? null}
            filename={preview?.filename ?? "documento"}
            mimeType={preview?.mimeType ?? null}
            isLoading={preview?.loading ?? true}
            className="pointer-events-auto h-full w-full max-w-3xl"
          />
        </div>
      )}

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[600px]"
        onInteractOutside={(e) => {
          // The document sidecar floats outside the sheet content; clicks on its
          // toolbar must not be treated as "click outside" (which would close it).
          const target = e.detail.originalEvent.target;
          if (target instanceof Element && target.closest("[data-doc-sidecar]")) {
            e.preventDefault();
          }
        }}
      >
        <SheetHeader className="space-y-1 border-b px-4 py-3 text-left">
          <SheetTitle className="truncate text-base">
            {data?.file?.original_filename ?? "Documento"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Revisión del documento escaneado y sus datos extraídos.
          </SheetDescription>
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
            {expense && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Sparkles className="size-3" />
                Cuenta: {expense.account}
                {expense.confidence != null
                  ? ` · ${Math.round(expense.confidence * 100)}%`
                  : ""}
                {expense.costCenter ? ` · CC ${expense.costCenter}` : ""}
              </span>
            )}
            {recon && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <CheckCircle2 className="size-3" />
                Conciliación: {recon.matched}/{recon.total} conciliados
              </span>
            )}
          </div>
        </SheetHeader>

        {detail.isLoading ? (
          <div className="flex-1 p-4">
            <Skeleton className="h-full w-full" />
          </div>
        ) : data ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <DocumentDetail payload={data.payload} kind={kind} />
            <ReviewActions
              extraction={data}
              onCreated={() => onOpenChange(false)}
              onNestedOpenChange={setNestedOpen}
            />
          </div>
        ) : (
          <p className="text-muted-foreground flex-1 p-4 text-sm">
            No se pudo cargar la extracción.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
