"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { FileDropzone } from "@/components/file-upload/file-dropzone";
import { FilePreviewDialog } from "@/components/file-preview/file-preview-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  fetchSignedUrl,
  useAttachments,
  useDetachFile,
  useUploadFile,
} from "../hooks/use-attachments";
import {
  ATTACHMENT_KIND_BY_TARGET,
  ATTACHMENT_KIND_LABELS,
  type AttachmentTargetType,
  type FileAttachmentRow,
} from "../schema";

import { AttachmentRow } from "./attachment-row";

type Props = {
  targetType: AttachmentTargetType;
  targetId: string;
  canWrite: boolean;
  canDelete: boolean;
};

export function AttachmentsZone({
  targetType,
  targetId,
  canWrite,
  canDelete,
}: Props) {
  const kinds = ATTACHMENT_KIND_BY_TARGET[targetType];
  const [kind, setKind] = useState<string>(kinds[0] ?? "comprobante");
  const [preview, setPreview] = useState<{
    url: string | null;
    filename: string;
    mimeType: string | null;
  } | null>(null);

  const { data: rows = [], isLoading } = useAttachments(targetType, targetId);
  const uploadMutation = useUploadFile();
  const detachMutation = useDetachFile(targetType, targetId);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        await uploadMutation.mutateAsync({
          file,
          kind,
          targetType,
          targetId,
        });
        toast.success(`${file.name} adjuntado.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo subir.");
      }
    },
    [uploadMutation, kind, targetType, targetId],
  );

  const handlePreview = useCallback(async (row: FileAttachmentRow) => {
    setPreview({ url: null, filename: row.filename, mimeType: row.mimeType });
    try {
      const signed = await fetchSignedUrl(row.fileId);
      setPreview({
        url: signed.url,
        filename: signed.filename,
        mimeType: signed.mimeType,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo abrir el adjunto.",
      );
      setPreview(null);
    }
  }, []);

  return (
    <div className="space-y-3">
      {canWrite ? (
        <div className="space-y-3">
          {kinds.length > 1 ? (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="attachment-kind">
                Tipo:
              </label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="attachment-kind" className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {ATTACHMENT_KIND_LABELS[k] ?? k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <FileDropzone
            onFile={handleFile}
            onError={(error) => toast.error(error)}
            disabled={uploadMutation.isPending}
            placeholder={
              uploadMutation.isPending
                ? "Subiendo…"
                : "Arrastrá un archivo o elegí desde el dispositivo"
            }
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando adjuntos…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canWrite ? "Todavía no hay adjuntos." : "Sin adjuntos."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <AttachmentRow
              key={row.attachmentId}
              row={row}
              onPreview={handlePreview}
              onDelete={async (id) => {
                await detachMutation.mutateAsync(id);
              }}
              canDelete={canDelete}
            />
          ))}
        </ul>
      )}

      <FilePreviewDialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        url={preview?.url ?? null}
        filename={preview?.filename ?? ""}
        mimeType={preview?.mimeType ?? null}
      />
    </div>
  );
}
