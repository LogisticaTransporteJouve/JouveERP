/** Saves `blob` in the browser as `fileName`. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a title: lowercase ASCII words joined by dashes. */
export function exportFileName(title: string, extension: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "export"}.${extension}`;
}

/**
 * Downloads a file a route serves, under the name its Content-Disposition
 * gives (or `fallbackName`). Throws when it fails, with the route's `{ error }`
 * message for a refused request (already user copy) and a generic one for a
 * server error, so the caller can show it instead of leaving the page.
 */
export async function downloadFromUrl(
  url: string,
  fallbackName: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      res.status < 500 &&
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "No se pudo descargar el archivo.";
    throw new Error(message);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  downloadBlob(name, await res.blob());
}
