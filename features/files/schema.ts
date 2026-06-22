import { z } from "zod";

// Attachable entity types. K.10 shipped with purchase_invoice; M.4
// extended it to 8 more.
export const ATTACHMENT_TARGET_TYPES = [
  "purchase_invoice",
  "invoice",
  "receipt",
  "payment_order",
  "check",
  "issued_check",
  "client",
  "supplier",
  "transaction",
] as const;
export type AttachmentTargetType = (typeof ATTACHMENT_TARGET_TYPES)[number];

// Per-target whitelist of `kind`. Enforced in the server action; the DB
// only checks length (free text).
export const ATTACHMENT_KIND_BY_TARGET: Record<
  AttachmentTargetType,
  readonly string[]
> = {
  purchase_invoice: ["comprobante", "remito", "otro"],
  invoice:          ["comprobante", "remito", "otro"],
  receipt:          ["comprobante", "comprobante_pago", "otro"],
  payment_order:    ["comprobante_pago", "transferencia", "otro"],
  check:            ["foto_cheque", "comprobante_depósito", "otro"],
  issued_check:     ["foto_cheque", "otro"],
  client:           ["constancia_inscripcion", "contrato", "otro"],
  supplier:         ["constancia_inscripcion", "contrato", "otro"],
  transaction:      ["comprobante", "otro"],
} as const;

export const ATTACHMENT_KIND_LABELS: Record<string, string> = {
  comprobante: "Comprobante",
  remito: "Remito",
  comprobante_pago: "Comprobante de pago",
  transferencia: "Transferencia",
  foto_cheque: "Foto del cheque",
  comprobante_depósito: "Comprobante de depósito",
  constancia_inscripcion: "Constancia de inscripción",
  contrato: "Contrato",
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
