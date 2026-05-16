import { z } from "zod";

// Atachable entity types. K.10 ships with `purchase_invoice` only; M.4
// extends this union as new FKs land in `file_attachments`.
export const ATTACHMENT_TARGET_TYPES = ["purchase_invoice"] as const;
export type AttachmentTargetType = (typeof ATTACHMENT_TARGET_TYPES)[number];

// Per-target whitelist of `kind` values. Enforced in the server action so
// the DB can stay loose on `kind` (free text + length check). When M.4 adds
// a new target, sum its allowed kinds here.
export const ATTACHMENT_KIND_BY_TARGET: Record<
  AttachmentTargetType,
  readonly string[]
> = {
  purchase_invoice: ["comprobante", "remito", "otro"],
} as const;

export const ATTACHMENT_KIND_LABELS: Record<string, string> = {
  comprobante: "Comprobante",
  remito: "Remito",
  otro: "Otro",
};

export const AttachmentTargetSchema = z.object({
  targetType: z.enum(ATTACHMENT_TARGET_TYPES),
  targetId: z.string().uuid(),
});

export type AttachmentTarget = z.infer<typeof AttachmentTargetSchema>;

export type FileAttachmentRow = {
  attachmentId: string;
  fileId: string;
  kind: string;
  attachedAt: string;
  createdBy: string | null;
  filename: string;
  mimeType: string | null;
  fileSize: number | null;
  targetType: AttachmentTargetType;
  targetId: string;
};
