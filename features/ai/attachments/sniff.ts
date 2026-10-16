// The reported MIME type comes from the browser; the bytes decide whether
// the file is what it claims before it reaches storage or the model.

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0) {
  return signature.every((b, i) => bytes[at + i] === b);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** True when `bytes` look like a file of type `mime`. */
export function bytesMatchMime(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "application/pdf":
      // Some generators put a few bytes (BOM, whitespace) before the header.
      return Array.from({ length: 16 }, (_, i) => i).some((i) =>
        startsWith(bytes, PDF, i),
      );
    case "image/png":
      return startsWith(bytes, PNG);
    case "image/jpeg":
      return startsWith(bytes, JPEG);
    case "image/webp":
      return startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return startsWith(bytes, ZIP);
    case "text/csv":
      return !bytes.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}
