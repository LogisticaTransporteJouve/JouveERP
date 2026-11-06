import { z } from "zod";

import { UuidSchema } from "@/lib/validation/common";

import { isScannableMime } from "../../attachments/limits";
import {
  findOwnSentAttachment,
  hasDocumentExtraction,
} from "../../attachments/store";
import { listExtractionsAction } from "../../document/actions";
import { startDocumentExtraction } from "../../document/start";
import { DOCUMENT_KINDS, EXTRACTIONS_LIST_LIMIT } from "../../document/types";
import { documentScanProposalSpec } from "../../lib/proposal-specs";
import { defineAiAction } from "../define";
import { defineAiProposal } from "../propose";
import { errResult, okResult, reachedCap } from "../result";

const EXTRACTION_STATUSES = [
  "pending_review",
  "confirmed",
  "discarded",
  "failed",
  "all",
] as const;

export const getDocumentExtractions = defineAiAction({
  name: "getDocumentExtractions",
  domain: "general",
  permission: "ai:read",
  sideEffect: "read",
  sources: ["ai_document_extractions", "files"],
  description:
    "Documentos escaneados (bandeja Documentos): cada archivo leído por Document Intelligence con su nombre, el tipo detectado (factura de compra, recibo, extracto…), la confianza, el estado (pending_review = falta revisarlo, confirmed, discarded, failed) y la fecha; los 100 más recientes del estado pedido. Para '¿qué documentos faltan revisar?'.",
  input: z.object({
    status: z
      .enum(EXTRACTION_STATUSES)
      .nullish()
      .describe("Estado (default pending_review; all = todos)."),
  }),
  run: async (_ctx, input) => {
    const status = input.status ?? "pending_review";
    const res = await listExtractionsAction(status);
    if (!res.ok) return errResult(res.error);
    const rows = res.data.map(({ matches: _matches, ...row }) => row);
    return okResult(
      `${rows.length} documentos escaneados (${status})` +
        (reachedCap(rows.length, EXTRACTIONS_LIST_LIMIT)
          ? `: se muestran los ${EXTRACTIONS_LIST_LIMIT} más recientes.`
          : "."),
      rows,
      { partial: reachedCap(rows.length, EXTRACTIONS_LIST_LIMIT) },
    );
  },
});

// Hand-off from a chat attachment to Document Intelligence: the assistant
// proposes, the user confirms, and the same pipeline as the Documentos tray
// reads the file and leaves a draft to review there.

export const proposeDocumentScan = defineAiProposal({
  name: "proposeDocumentScan",
  domain: "general",
  // extractDocumentAction's gate, plus the chat.
  permission: ["ai:chat", "ai:read", "files:write"],
  sources: ["files", "ai_document_extractions"],
  description:
    "Propose sending a file the user attached in this chat (PDF or image) to " +
    "Document Intelligence (Documentos), which extracts it into a draft the " +
    "user reviews before anything is created. Use it when an attachment looks " +
    "like a comprobante the user wants to load (factura, recibo, orden de " +
    "pago, cheque, remito, extracto). Writes nothing by itself.",
  input: z.object({
    fileId: UuidSchema.describe(
      "The attachment's fileId, as its label in the conversation shows it.",
    ),
    declared_type: z
      .enum(DOCUMENT_KINDS)
      .optional()
      .describe("Document type when it is clear; omit to let it classify."),
  }),
  spec: documentScanProposalSpec,
  prepare: async (ctx, input) => {
    const file = await findOwnSentAttachment(ctx.userId, input.fileId);
    if (!file) {
      return {
        kind: "error",
        error: "No encontré ese adjunto en tus conversaciones.",
      };
    }
    if (!isScannableMime(file.mimeType)) {
      return {
        kind: "error",
        error: "Documentos solo lee PDF e imágenes (PNG, JPG, WebP).",
      };
    }
    if (await hasDocumentExtraction(file.fileId)) {
      return {
        kind: "error",
        error: "Ese archivo ya se mandó a Documentos.",
      };
    }
    return {
      kind: "draft",
      draft: {
        file_id: file.fileId,
        declared_type: input.declared_type ?? "auto",
      },
      labels: { [file.fileId]: file.filename },
    };
  },
  execute: async (ctx, draft) => {
    // Re-checked at confirm time: the card may be older than a session delete.
    const file = await findOwnSentAttachment(ctx.userId, draft.file_id);
    if (!file) return { ok: false, error: "El adjunto ya no está disponible." };
    if (await hasDocumentExtraction(file.fileId)) {
      return { ok: false, error: "Ese archivo ya se mandó a Documentos." };
    }
    const res = await startDocumentExtraction(ctx.userId, {
      fileId: draft.file_id,
      declaredType: draft.declared_type === "auto" ? null : draft.declared_type,
    });
    return res.ok ? { ok: true, data: { id: res.data.extractionId } } : res;
  },
});
