import { z } from "zod";

import { listAttachmentsAction } from "@/features/files/actions/files-actions";
import { ATTACHMENT_TARGET_TYPES } from "@/features/files/schema";
import { searchGlobalAction } from "@/features/search/actions/search-actions";
import { UuidSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, okResult } from "../result";

export const searchGlobal = defineAiAction({
  name: "searchGlobal",
  domain: "general",
  // search_global filters entity types by role inside the RPC; clients:read is
  // held by every role it returns anything to.
  permission: "clients:read",
  sideEffect: "read",
  sources: ["search_global"],
  description:
    "Búsqueda de texto en todo el sistema (clientes, proveedores, comprobantes, facturas de compra, recibos, órdenes de pago, movimientos), filtrada según el rol. Devuelve tipo, título e id de cada resultado.",
  input: z.object({
    query: z.string().trim().min(2).max(200).describe("Texto a buscar."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .nullish()
      .describe("Máximo (default 20)."),
  }),
  run: async (_ctx, input) => {
    const res = await searchGlobalAction({
      query: input.query,
      limit: input.limit ?? 20,
    });
    if (!res.ok) return errResult(res.error);
    return okResult(
      `${res.data.length} resultados para "${input.query}".`,
      res.data,
    );
  },
});

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
    return okResult(`${res.data.length} adjuntos.`, res.data);
  },
});
