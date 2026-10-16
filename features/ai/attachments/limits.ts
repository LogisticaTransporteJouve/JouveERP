// What the AI chat accepts as an attachment, shared by the composer (UX) and
// the server (enforcement). The MIME list is a subset of the `files` bucket's
// `allowed_mime_types`; legacy .xls is not readable without a parser.

export const CHAT_ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WebP",
  "text/csv": "CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const CHAT_ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx";

/** The `files` bucket's file_size_limit. */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The model API's cap per image (photos are downscaled before upload). */
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const CHAT_ATTACHMENTS_PER_MESSAGE = 5;

/** Pages per PDF attachment. */
export const CHAT_PDF_MAX_PAGES = 20;

/**
 * What one model turn replays, newest attachment first. Anything past the
 * budget reaches the model as a one-line note instead of its content (every
 * step of the tool loop resends the whole history).
 */
export type AttachmentBudget = {
  files: number;
  bytes: number;
  pdfPages: number;
  tableChars: number;
};

export const CHAT_ATTACHMENT_BUDGET: AttachmentBudget = {
  files: 8,
  bytes: 8 * 1024 * 1024,
  pdfPages: 40,
  tableChars: 60_000,
};

/** How much of a CSV/XLSX the model reads. */
export const CHAT_TABLE_LIMITS = {
  rows: 200,
  columns: 30,
  cellChars: 200,
} as const;

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  xlsx: XLSX_MIME,
};

/**
 * The MIME type to store for an upload. Browsers report CSV as
 * `application/vnd.ms-excel` (Windows) or as an empty string, so a `.csv`
 * name wins over those two; any other reported type is kept as is.
 */
export function normalizeChatAttachmentMime(
  filename: string,
  reported: string,
): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const fromExt = EXTENSION_MIME[ext];
  if (!reported || reported === "application/octet-stream") {
    return fromExt ?? reported;
  }
  if (reported === "application/vnd.ms-excel" && ext === "csv") {
    return "text/csv";
  }
  return reported;
}

/** User-facing reason a file can't be attached, or null. */
export function validateChatAttachment(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const mime = normalizeChatAttachmentMime(file.name, file.type);
  if (!(mime in CHAT_ATTACHMENT_TYPES)) {
    return `Tipo no permitido. Aceptados: ${Object.values(CHAT_ATTACHMENT_TYPES).join(", ")}.`;
  }
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return "El archivo supera 10 MB.";
  }
  if (mime.startsWith("image/") && file.size > CHAT_IMAGE_MAX_BYTES) {
    return "La imagen supera 5 MB.";
  }
  return null;
}

/** Types Document Intelligence reads (features/ai/document/actions.ts). */
export function isScannableMime(mime: string | null | undefined): boolean {
  return (
    mime === "application/pdf" ||
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/webp"
  );
}
