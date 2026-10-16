/** Saves `blob` in the browser as `fileName`. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lowercase ASCII words joined by dashes ("" when nothing is left). */
export function exportSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** A file name from a title. */
export function exportFileName(title: string, extension: string): string {
  return `${exportSlug(title) || "export"}.${extension}`;
}

export const SESSION_EXPIRED_MESSAGE =
  "Tu sesión expiró, volvé a iniciar sesión.";
const GENERIC_MESSAGE = "No se pudo descargar el archivo.";

/**
 * Downloads a file a route serves, under the name its Content-Disposition
 * gives (or `fallbackName`). Throws when it fails, so the caller can show the
 * message instead of leaving the page: the route's `{ error }` for a refused
 * request (already user copy), a session notice when the request was sent to
 * the login page, and a generic one otherwise. Anything that is not
 * `expectedType` is never saved.
 */
export async function downloadFromUrl(
  url: string,
  fallbackName: string,
  expectedType: string,
): Promise<void> {
  const res = await fetch(url);
  const type = res.headers.get("Content-Type") ?? "";
  if (res.redirected || res.status === 401 || type.startsWith("text/html")) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      res.status < 500 &&
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : GENERIC_MESSAGE;
    throw new Error(message);
  }
  if (!type.startsWith(expectedType)) throw new Error(GENERIC_MESSAGE);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  downloadBlob(name, await res.blob());
}
