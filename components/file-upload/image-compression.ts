// Client-side downscale + re-encode for photos before upload. Phone cameras
// produce 4–12 MB JPEGs (or HEIC on iPhone) — far above what OCR/extraction
// needs and close to (or over) the bucket's 10 MB cap. Re-encoding to JPEG
// also normalizes HEIC gallery picks that the MIME whitelist would reject.

import { ALLOWED_IMAGE_TYPES } from "./file-upload-utils";

/** Above this size an image gets downscaled/re-encoded. */
export const COMPRESS_THRESHOLD = 1.5 * 1024 * 1024;
/** Longest side after downscale — plenty for document OCR. */
export const MAX_DIMENSION = 2200;
const JPEG_QUALITY = 0.82;

export function shouldCompressImage(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  // Non-whitelisted image types (HEIC/HEIF/TIFF…) always re-encode, else the
  // whitelist rejects them; whitelisted ones only when they're heavy.
  if (!(file.type in ALLOWED_IMAGE_TYPES)) return true;
  return file.size > COMPRESS_THRESHOLD;
}

export function jpegFileName(name: string): string {
  const base = name.replace(/\.[^.]*$/, "");
  return `${base.length > 0 ? base : "foto"}.jpg`;
}

/**
 * Returns a downscaled JPEG version of `file`, or the original when
 * compression isn't needed, fails (e.g. the browser can't decode the format),
 * or wouldn't shrink an already-valid file.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!shouldCompressImage(file)) return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return file;
    // A rare already-optimized JPEG can re-encode larger; keep the original
    // if it was acceptable as-is.
    if (blob.size >= file.size && file.type in ALLOWED_IMAGE_TYPES) {
      return file;
    }
    return new File([blob], jpegFileName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
