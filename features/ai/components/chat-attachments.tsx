"use client";

import { Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FilePreviewDialog } from "@/components/file-preview/file-preview-dialog";
import { MimeIcon } from "@/components/file-preview/mime-icon";
import { formatFileSize } from "@/lib/files/format-file-size";
import { runAction } from "@/lib/query/run-action";
import { cn } from "@/lib/utils";

import { getChatAttachmentUrlAction } from "../attachments/actions";
import type { ChatAttachment } from "../attachments/schema";
import type { DraftAttachment } from "../hooks/use-chat-attachments";

const CHIP =
  "flex max-w-[16rem] items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-xs";

/** The composer's pending attachments, with upload state and remove. */
export function ComposerAttachments({
  drafts,
  onRemove,
}: {
  drafts: readonly DraftAttachment[];
  onRemove: (localId: string) => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Adjuntos del mensaje">
      {drafts.map((d) => (
        <li
          key={d.localId}
          className={cn(CHIP, d.status === "error" && "border-dashed")}
        >
          {d.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={d.previewUrl}
              alt=""
              className="size-7 shrink-0 rounded object-cover"
            />
          ) : (
            <MimeIcon
              mimeType={d.mimeType}
              className="text-muted-foreground size-4 shrink-0"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{d.filename}</span>
            <span className="text-muted-foreground block">
              {d.status === "uploading"
                ? "Subiendo…"
                : d.status === "error"
                  ? "No se pudo subir"
                  : formatFileSize(d.size)}
            </span>
          </span>
          {d.status === "uploading" ? (
            <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
          ) : (
            <button
              type="button"
              onClick={() => onRemove(d.localId)}
              className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
              aria-label={`Quitar ${d.filename}`}
            >
              <X className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

type Preview = {
  url: string | null;
  filename: string;
  mimeType: string | null;
};

/** A sent message's attachments; opening one asks for a signed URL. */
export function MessageAttachments({
  attachments,
}: {
  attachments: readonly ChatAttachment[];
}) {
  const [preview, setPreview] = useState<Preview | null>(null);

  async function open(att: ChatAttachment) {
    setPreview({ url: null, filename: att.filename, mimeType: att.mimeType });
    try {
      const signed = await runAction(() =>
        getChatAttachmentUrlAction(att.fileId),
      );
      setPreview({
        url: signed.url,
        filename: signed.filename,
        mimeType: signed.mimeType,
      });
    } catch (err) {
      setPreview(null);
      toast.error(
        err instanceof Error ? err.message : "No se pudo abrir el adjunto.",
      );
    }
  }

  if (attachments.length === 0) return null;
  return (
    <>
      <ul className="flex max-w-[85%] flex-wrap justify-end gap-2">
        {attachments.map((att) => (
          <li key={att.fileId}>
            <button
              type="button"
              onClick={() => void open(att)}
              className={cn(CHIP, "hover:bg-muted")}
              title={`Ver ${att.filename}`}
            >
              <MimeIcon
                mimeType={att.mimeType}
                className="text-muted-foreground size-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {att.filename}
                </span>
                <span className="text-muted-foreground block">
                  {formatFileSize(att.size)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <FilePreviewDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
        url={preview?.url ?? null}
        filename={preview?.filename ?? ""}
        mimeType={preview?.mimeType ?? null}
      />
    </>
  );
}
