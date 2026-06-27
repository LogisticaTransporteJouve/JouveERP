"use client";

import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { FileDropzone } from "@/components/file-upload/file-dropzone";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  useDiscardExtraction,
  useExtractions,
  useScanDocument,
} from "../hooks/use-documents";

import { buildDocumentColumns } from "./columns";
import { ReviewSheet } from "./review-sheet";

const STATUS_TABS = [
  { value: "pending_review", label: "Pendientes" },
  { value: "confirmed", label: "Confirmados" },
  { value: "discarded", label: "Descartados" },
  { value: "failed", label: "Fallidos" },
];

export function DocumentsTray() {
  const [status, setStatus] = useState("pending_review");
  const { data: rows = [], isLoading } = useExtractions(status);
  const scan = useScanDocument();
  const discard = useDiscardExtraction();
  const confirm = useConfirm();
  const [reviewId, setReviewId] = useState<string | null>(null);

  function handleFile(file: File) {
    scan.mutate(file, {
      onSuccess: () => toast.success("Documento en proceso…"),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "No se pudo escanear."),
    });
  }

  const columns = useMemo(
    () =>
      buildDocumentColumns({
        onReview: (id) => setReviewId(id),
        onDiscard: async (id) => {
          const ok = await confirm({
            title: "Descartar documento",
            description:
              "Se descarta la extracción. El archivo queda subido pero no se crea ninguna entidad.",
            confirmLabel: "Descartar",
            tone: "destructive",
          });
          if (!ok) return;
          discard.mutate(id, {
            onError: (err) =>
              toast.error(
                err instanceof Error ? err.message : "No se pudo descartar.",
              ),
          });
        },
      }),
    [confirm, discard],
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
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

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        isLoading={isLoading}
        emptyMessage="No hay documentos en este estado."
        enablePagination
        initialPageSize={20}
        defaultSorting={[{ id: "created_at", desc: true }]}
      />

      <ReviewSheet
        extractionId={reviewId}
        onOpenChange={(open) => {
          if (!open) setReviewId(null);
        }}
      />
    </div>
  );
}
