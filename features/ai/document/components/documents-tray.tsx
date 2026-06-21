"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FileDropzone } from "@/components/file-upload/file-dropzone";
import { FilePreviewDialog } from "@/components/file-preview/file-preview-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSignedUrl } from "@/features/files/hooks/use-attachments";

import { ExtractionPayload } from "./extraction-payload";
import {
  useDiscardExtraction,
  useExtraction,
  usePendingExtractions,
  useScanDocument,
} from "../hooks/use-documents";

const TYPE_LABELS: Record<string, string> = {
  factura_compra: "Factura de compra",
  factura_venta: "Factura de venta",
  recibo: "Recibo",
  orden_pago: "Orden de pago",
  remito: "Remito",
  cheque: "Cheque",
  extracto: "Extracto",
  nc_nd: "NC / ND",
  otro: "Otro",
};

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

type PreviewState = { url: string | null; filename: string; mimeType: string | null };

export function DocumentsTray() {
  const { data: rows = [], isLoading } = usePendingExtractions();
  const scan = useScanDocument();
  const discard = useDiscardExtraction();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useExtraction(detailId);

  function handleFile(file: File) {
    scan.mutate(file, {
      onSuccess: () => toast.success("Documento en proceso…"),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "No se pudo escanear."),
    });
  }

  async function openPreview(fileId: string, filename: string, mimeType: string | null) {
    setPreview({ url: null, filename, mimeType });
    try {
      const signed = await fetchSignedUrl(fileId);
      setPreview({ url: signed.url, filename: signed.filename, mimeType: signed.mimeType });
    } catch {
      toast.error("No se pudo abrir el archivo.");
      setPreview(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex items-center gap-2">
        <FileText className="size-5" />
        <h1 className="text-2xl font-semibold">Documentos</h1>
      </header>

      <FileDropzone
        onFile={handleFile}
        fileType="documents"
        disabled={scan.isPending}
        placeholder="Escaneá o subí una factura, recibo u orden de pago"
        description="La IA detecta el tipo y extrae los datos para revisar."
      />

      <section className="space-y-2">
        <h2 className="text-muted-foreground text-sm font-medium">
          Pendientes de revisar
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            No hay documentos pendientes. Subí uno para empezar.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const processing = row.detected_type === null;
              const filename = row.file?.original_filename ?? "documento";
              const info = matchInfo(row.matches);
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <FileText className="text-muted-foreground size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{filename}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {processing ? (
                        <span className="text-muted-foreground flex items-center gap-1 text-xs">
                          <Loader2 className="size-3 animate-spin" /> Leyendo
                          documento…
                        </span>
                      ) : (
                        <>
                          <Badge variant="outline" className="gap-1">
                            <Sparkles className="size-3" />
                            {TYPE_LABELS[row.detected_type ?? "otro"] ??
                              row.detected_type}
                            {row.confidence !== null
                              ? ` · ${Math.round(row.confidence * 100)}%`
                              : ""}
                          </Badge>
                          {info.name && (
                            <span className="text-muted-foreground flex items-center gap-1 text-xs">
                              <CheckCircle2 className="size-3" /> {info.name}
                            </span>
                          )}
                          {info.duplicate && (
                            <span className="text-muted-foreground flex items-center gap-1 text-xs">
                              <AlertTriangle className="size-3" /> Posible
                              duplicado
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        openPreview(row.file_id, filename, row.file?.mime_type ?? null)
                      }
                    >
                      Archivo
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={processing}
                      onClick={() => setDetailId(row.id)}
                    >
                      Datos
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <Trash2 className="size-4" />
                          <span className="sr-only">Descartar</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Descartar documento</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se descarta la extracción. El archivo queda subido pero
                            no se crea ninguna entidad.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => discard.mutate(row.id)}>
                            Descartar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <FilePreviewDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        url={preview?.url ?? null}
        filename={preview?.filename ?? ""}
        mimeType={preview?.mimeType ?? null}
      />

      <Dialog
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Datos extraídos</DialogTitle>
          </DialogHeader>
          {detail.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.data ? (
            <ExtractionPayload payload={detail.data.payload} />
          ) : (
            <p className="text-muted-foreground text-sm">
              No se pudo cargar la extracción.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
