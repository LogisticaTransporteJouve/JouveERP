"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  detachFileAction,
  getSignedFileUrlAction,
  listAttachmentsAction,
  uploadFileAction,
} from "../actions/files-actions";
import { filesKeys } from "../lib/files-keys";
import type { AttachmentTargetType } from "../schema";

export function useAttachments(
  targetType: AttachmentTargetType,
  targetId: string,
) {
  useRealtimeInvalidate([
    {
      table: "file_attachments",
      queryKeys: [filesKeys.attachments(targetType, targetId)],
    },
  ]);

  // A failed read stays an error (the zone says so): shown as "no
  // attachments" it reads as a document that was never attached.
  return useQuery({
    queryKey: filesKeys.attachments(targetType, targetId),
    queryFn: () =>
      runAction(() => listAttachmentsAction({ targetType, targetId })),
  });
}

type UploadVars = {
  file: File;
  kind: string;
  targetType: AttachmentTargetType;
  targetId: string;
};

export function useUploadFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, kind, targetType, targetId }: UploadVars) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      fd.append("targetType", targetType);
      fd.append("targetId", targetId);
      const res = await uploadFileAction(fd);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (_data, { targetType, targetId }) => {
      queryClient.invalidateQueries({
        queryKey: filesKeys.attachments(targetType, targetId),
      });
    },
  });
}

export function useDetachFile(
  targetType: AttachmentTargetType,
  targetId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      const res = await detachFileAction(attachmentId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: filesKeys.attachments(targetType, targetId),
      });
    },
  });
}

export async function fetchSignedUrl(
  fileId: string,
): Promise<{ url: string; filename: string; mimeType: string | null }> {
  const res = await getSignedFileUrlAction(fileId);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
