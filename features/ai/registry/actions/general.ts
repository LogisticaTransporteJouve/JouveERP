import { z } from "zod";

import { listAttachmentsAction } from "@/features/files/actions/files-actions";
import { ATTACHMENT_TARGET_TYPES } from "@/features/files/schema";
import { UuidSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, okResult, reachedCap } from "../result";

export const getAttachments = defineAiAction({
  name: "getAttachments",
  domain: "general",
  permission: "files:read",
  sideEffect: "read",
  sources: ["file_attachments", "files"],
  description:
    "Archivos adjuntos de UNA entidad (comprobante, factura de compra, recibo, orden de pago, cheque, cliente, proveedor, movimiento): solo metadatos (nombre, tipo, tamaño, fecha), nunca el contenido.",
  input: z.object({
    targetType: z.enum(ATTACHMENT_TARGET_TYPES).describe("Tipo de entidad."),
    targetId: UuidSchema.describe("UUID de la entidad."),
  }),
  run: async (_ctx, input) => {
    const res = await listAttachmentsAction(input);
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} adjuntos.`, res.data, {
      partial: reachedCap(res.data.length),
    });
  },
});
