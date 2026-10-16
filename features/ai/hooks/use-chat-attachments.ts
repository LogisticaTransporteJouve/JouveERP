"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { prepareImageForUpload } from "@/components/file-upload/image-compression";

import {
  discardChatAttachmentAction,
  uploadChatAttachmentAction,
} from "../attachments/actions";
import {
  CHAT_ATTACHMENTS_PER_MESSAGE,
  validateChatAttachment,
} from "../attachments/limits";
import type { ChatAttachment } from "../attachments/schema";

export type DraftAttachment = {
  localId: string;
  filename: string;
  size: number;
  mimeType: string;
  /** Object URL for an image thumbnail (revoked on remove/unmount). */
  previewUrl: string | null;
} & (
  | { status: "uploading" }
  | { status: "ready"; attachment: ChatAttachment }
  | { status: "error"; error: string }
);

/**
 * The composer's attachments: each file is validated, photos are downscaled,
 * and it uploads as soon as it is added, so sending only references file ids.
 */
export function useChatAttachments(onError: (message: string) => void) {
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  useEffect(
    () => () => {
      for (const d of draftsRef.current) {
        if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
      }
    },
    [],
  );

  const add = useCallback(
    async (files: readonly File[]) => {
      const room = CHAT_ATTACHMENTS_PER_MESSAGE - draftsRef.current.length;
      if (files.length > room) {
        onError(
          `Podés adjuntar hasta ${CHAT_ATTACHMENTS_PER_MESSAGE} archivos por mensaje.`,
        );
      }
      for (const original of files.slice(0, Math.max(0, room))) {
        const file = await prepareImageForUpload(original);
        const invalid = validateChatAttachment(file);
        if (invalid) {
          onError(`${file.name}: ${invalid}`);
          continue;
        }
        const localId = crypto.randomUUID();
        const base = {
          localId,
          filename: file.name,
          size: file.size,
          mimeType: file.type,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : null,
        };
        setDrafts((prev) => [...prev, { ...base, status: "uploading" }]);
        const fd = new FormData();
        fd.append("file", file);
        let next: DraftAttachment;
        try {
          const res = await uploadChatAttachmentAction(fd);
          next = res.ok
            ? { ...base, status: "ready", attachment: res.data }
            : { ...base, status: "error", error: res.error };
        } catch {
          next = { ...base, status: "error", error: "No se pudo subir." };
        }
        if (next.status === "error") onError(`${file.name}: ${next.error}`);
        setDrafts((prev) =>
          prev.map((d) => (d.localId === localId ? next : d)),
        );
      }
    },
    [onError],
  );

  const remove = useCallback((localId: string) => {
    const draft = draftsRef.current.find((d) => d.localId === localId);
    if (!draft) return;
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    setDrafts((prev) => prev.filter((d) => d.localId !== localId));
    if (draft.status === "ready") {
      void discardChatAttachmentAction(draft.attachment.fileId);
    }
  }, []);

  /** Hands the uploaded files to a send and empties the composer. */
  const takeReady = useCallback((): ChatAttachment[] => {
    const ready = draftsRef.current.flatMap((d) =>
      d.status === "ready" ? [d.attachment] : [],
    );
    for (const d of draftsRef.current) {
      if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    }
    setDrafts([]);
    return ready;
  }, []);

  return {
    drafts,
    add,
    remove,
    takeReady,
    uploading: drafts.some((d) => d.status === "uploading"),
    readyCount: drafts.filter((d) => d.status === "ready").length,
  };
}
