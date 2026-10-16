import { z } from "zod";

/** UIMessage data part that carries one chat attachment (by file id). */
export const ATTACHMENT_PART = "data-attachment";

export const ChatAttachmentSchema = z.object({
  fileId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().nonnegative(),
});

/** What the composer, the persisted message and the chips know of a file. */
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

/** The only field the server takes from a client-sent attachment part. */
export const IncomingAttachmentPartSchema = z.object({
  type: z.literal(ATTACHMENT_PART),
  data: z.object({ fileId: z.string().uuid() }),
});

export type ChatAttachmentPart = {
  type: typeof ATTACHMENT_PART;
  id: string;
  data: ChatAttachment;
};

export function attachmentPart(attachment: ChatAttachment): ChatAttachmentPart {
  return { type: ATTACHMENT_PART, id: attachment.fileId, data: attachment };
}

/** The attachment of a message part, or null when the part is not one. */
export function readAttachmentPart(part: {
  type: string;
  data?: unknown;
}): ChatAttachment | null {
  if (part.type !== ATTACHMENT_PART) return null;
  const parsed = ChatAttachmentSchema.safeParse(part.data);
  return parsed.success ? parsed.data : null;
}
