import { z } from "zod";

import { listAttachmentsAction } from "@/features/files/actions/files-actions";
import { listHubFilesAction } from "@/features/files/actions/hub-actions";
import { HUB_ENTITY_TYPES, HUB_FILE_KINDS } from "@/features/files/lib/hub";
import { ATTACHMENT_TARGET_TYPES } from "@/features/files/schema";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

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

export const searchFiles = defineAiAction({
  name: "searchFiles",
  domain: "general",
  permission: "files:read",
  sideEffect: "read",
  sources: ["v_files_hub"],
  description:
    "Buscar archivos en el centro de Archivos (todas las entidades que el usuario puede ver): por nombre, tipo de entidad, tipo de archivo (pdf, imagen, planilla) y fecha de subida. Devuelve nombre, entidad a la que está vinculado, quién lo subió y cuándo; solo metadatos, nunca el contenido. Los adjuntos de UNA entidad están en getAttachments.",
  input: z.object({
    search: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullish()
      .describe("Texto del nombre del archivo."),
    entityType: z
      .enum(HUB_ENTITY_TYPES)
      .nullish()
      .describe("Tipo de entidad vinculada."),
    fileKind: z.enum(HUB_FILE_KINDS).nullish().describe("Tipo de archivo."),
    dateFrom: IsoDateSchema.nullish().describe("Subido desde, YYYY-MM-DD."),
    dateTo: IsoDateSchema.nullish().describe("Subido hasta, YYYY-MM-DD."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullish()
      .describe("Máximo de filas (default 50, máx 100)."),
  }),
  run: async (_ctx, input) => {
    const res = await listHubFilesAction({
      ...input,
      limit: input.limit ?? 50,
    });
    if (!res.ok) return errResult(res.error);
    const more = res.data.nextCursor !== null;
    return okResult(
      `${res.data.items.length} archivos` +
        (more ? " (hay más: acotá la búsqueda)." : "."),
      res.data.items,
      { partial: more },
    );
  },
});
