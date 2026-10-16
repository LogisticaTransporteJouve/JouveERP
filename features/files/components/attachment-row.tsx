"use client";

import { Eye, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { MimeIcon } from "@/components/file-preview/mime-icon";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/files/format-file-size";
import { formatArDateShort } from "@/lib/format";

import { ATTACHMENT_KIND_LABELS, type FileAttachmentRow } from "../schema";

type Props = {
  row: FileAttachmentRow;
  onPreview: (row: FileAttachmentRow) => void;
  onDelete: (attachmentId: string) => Promise<void>;
  canDelete: boolean;
};

export function AttachmentRow({ row, onPreview, onDelete, canDelete }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(row.attachmentId);
      toast.success("Adjunto eliminado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo borrar.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
      <MimeIcon
        mimeType={row.mimeType}
        className="size-5 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.filename}</p>
        <p className="text-xs text-muted-foreground">
          {ATTACHMENT_KIND_LABELS[row.kind] ?? row.kind} ·{" "}
          {formatFileSize(row.fileSize)} · {formatArDateShort(row.attachedAt)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onPreview(row)}
        aria-label="Ver adjunto"
      >
        <Eye className="size-4" />
      </Button>
      {canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isDeleting}
              aria-label="Borrar adjunto"
            >
              {isDeleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4 text-destructive" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Borrar este adjunto</AlertDialogTitle>
              <AlertDialogDescription>
                Vas a eliminar{" "}
                <span className="font-medium">{row.filename}</span> de este
                registro. No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDelete}>
                Borrar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </li>
  );
}
