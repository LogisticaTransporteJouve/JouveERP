// Validation + presets for file uploads. The MIME whitelist mirrors the
// `files` bucket's `allowed_mime_types` (migration
// 20260516160200_files_storage_bucket.sql) — keep them in sync.

import { formatFileSize } from "@/lib/files/format-file-size";

export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WebP",
  "text/csv": "CSV",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WebP",
};

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB — matches bucket limit.

/** A spreadsheet or text table read by a server action (not stored in the
 *  bucket). A CSV often comes as "application/vnd.ms-excel" on Windows. */
export const ALLOWED_TABLE_TYPES: Record<string, string> = {
  "text/csv": "CSV",
  "text/plain": "TXT",
  "application/vnd.ms-excel": "CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

export const DOCUMENT_ACCEPT_STRING =
  ".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx";
export const IMAGE_ACCEPT_STRING = ".png,.jpg,.jpeg,.webp";

export type FileTypePreset = "documents" | "images" | "tables";

export type FileTypeConfig = {
  allowedTypes: Record<string, string>;
  acceptString: string;
  maxSize: number;
  /** null: no "Tomar foto" button. */
  cameraAccept: string | null;
};

export const FILE_TYPE_PRESETS: Record<FileTypePreset, FileTypeConfig> = {
  documents: {
    allowedTypes: ALLOWED_DOCUMENT_TYPES,
    acceptString: DOCUMENT_ACCEPT_STRING,
    maxSize: MAX_FILE_SIZE,
    cameraAccept: "image/*",
  },
  images: {
    allowedTypes: ALLOWED_IMAGE_TYPES,
    acceptString: IMAGE_ACCEPT_STRING,
    maxSize: MAX_FILE_SIZE,
    cameraAccept: "image/*",
  },
  // Server actions cap the request body at 4 MB (lib/tables/read-upload.ts).
  tables: {
    allowedTypes: ALLOWED_TABLE_TYPES,
    acceptString: ".csv,.txt,.xlsx",
    maxSize: 4 * 1024 * 1024,
    cameraAccept: null,
  },
};

export function validateFile(
  file: File,
  allowedTypes: Record<string, string> = ALLOWED_DOCUMENT_TYPES,
  maxSize: number = MAX_FILE_SIZE,
): string | null {
  if (!(file.type in allowedTypes)) {
    const labels = Object.values(allowedTypes).join(", ");
    return `Tipo no permitido. Aceptados: ${labels}.`;
  }
  if (file.size > maxSize) {
    return `El archivo supera ${formatFileSize(maxSize)}.`;
  }
  return null;
}

export function getFileTypeLabel(mime: string): string {
  return (
    ALLOWED_DOCUMENT_TYPES[mime] ??
    ALLOWED_IMAGE_TYPES[mime] ??
    mime.split("/").pop()?.toUpperCase() ??
    mime
  );
}
