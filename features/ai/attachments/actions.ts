"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { buildStorageKey } from "@/lib/files/storage-path";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";
import { UuidSchema } from "@/lib/validation/common";

import { canViewChatAttachment } from "./access";
import { attachmentMetadata, parseTable } from "./content";
import type { ParsedTable } from "./csv";
import {
  CHAT_PDF_MAX_PAGES,
  normalizeChatAttachmentMime,
  validateChatAttachment,
} from "./limits";
import { countPdfPages, isEncryptedPdf } from "./pdf-pages";
import type { ChatAttachment } from "./schema";
import { bytesMatchMime } from "./sniff";
import {
  deleteDraftAttachment,
  loadChatAttachmentFile,
  signStoredFile,
  storeDraftAttachment,
} from "./store";

const UPLOAD_RATE_LIMIT = {
  key: "ai:attachments:hourly",
  max: 60,
  windowMs: 60 * 60 * 1000,
} as const;

const NO_CHAT = "No tenés permiso para usar el chat de IA.";

/**
 * Uploads one file the user is about to send in the AI chat. It stays an
 * unsent draft (no attachment link) until the chat route links it to the
 * message; the orphan sweep removes drafts never sent.
 */
export async function uploadChatAttachmentAction(
  formData: FormData,
): Promise<ActionResult<ChatAttachment>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat") || !userCan(ctx.roles, "files:write")) {
    return { ok: false, error: NO_CHAT };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Archivo faltante." };
  const invalid = validateChatAttachment(file);
  if (invalid) return { ok: false, error: invalid };

  try {
    await enforceRateLimit({ userId: ctx.userId, ...UPLOAD_RATE_LIMIT });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return {
        ok: false,
        error: "Alcanzaste el límite de adjuntos por hora. Probá más tarde.",
      };
    }
    throw err;
  }

  const filename = file.name.slice(0, 255) || "adjunto";
  const mimeType = normalizeChatAttachmentMime(file.name, file.type);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytesMatchMime(bytes, mimeType)) {
    return {
      ok: false,
      error: "El contenido del archivo no coincide con su tipo.",
    };
  }

  let pages: number | null = null;
  let table: ParsedTable | null = null;
  if (mimeType === "application/pdf") {
    if (isEncryptedPdf(bytes)) {
      return {
        ok: false,
        error:
          "El PDF está protegido con contraseña o cifrado y no se puede leer. Subí una copia sin protección.",
      };
    }
    pages = countPdfPages(bytes);
    if (pages !== null && pages > CHAT_PDF_MAX_PAGES) {
      return {
        ok: false,
        error: `El PDF tiene ${pages} páginas; el máximo para el chat es ${CHAT_PDF_MAX_PAGES}.`,
      };
    }
  } else if (!mimeType.startsWith("image/")) {
    try {
      table = parseTable(mimeType, bytes);
    } catch (error) {
      logger.warn("ai.attachments.table_rejected", {
        userId: ctx.userId,
        error,
      });
      return { ok: false, error: "No se pudo leer la planilla." };
    }
  }

  const fileId = crypto.randomUUID();
  const stored = await storeDraftAttachment({
    userId: ctx.userId,
    fileId,
    bucketPath: buildStorageKey(fileId, filename),
    filename,
    mimeType,
    bytes,
    metadata: attachmentMetadata({ pages, table }),
  });
  if (!stored) return { ok: false, error: "No se pudo subir el archivo." };

  return {
    ok: true,
    data: { fileId, filename, mimeType, size: bytes.byteLength },
  };
}

/**
 * One-hour signed URL for a chat attachment: the session owner (or ai:admin,
 * who can read every session), or the uploader of an unsent draft.
 */
export async function getChatAttachmentUrlAction(
  fileId: string,
  options: { download?: boolean } = {},
): Promise<
  ActionResult<{ url: string; filename: string; mimeType: string | null }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) return { ok: false, error: NO_CHAT };
  const parsed = UuidSchema.safeParse(fileId);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const file = await loadChatAttachmentFile(parsed.data);
  if (
    !file ||
    !canViewChatAttachment(
      { userId: ctx.userId, isAiAdmin: userCan(ctx.roles, "ai:admin") },
      file,
    )
  ) {
    return { ok: false, error: "Archivo no encontrado." };
  }
  const url = await signStoredFile(file, options.download === true);
  if (!url) return { ok: false, error: "No se pudo generar la URL." };
  return {
    ok: true,
    data: { url, filename: file.filename, mimeType: file.mimeType },
  };
}

/** Drops an unsent draft the user removed from the composer. */
export async function discardChatAttachmentAction(
  fileId: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) return { ok: false, error: NO_CHAT };
  const parsed = UuidSchema.safeParse(fileId);
  if (!parsed.success) return { ok: false, error: "ID inválido." };
  await deleteDraftAttachment(ctx.userId, parsed.data);
  return { ok: true, data: undefined };
}
