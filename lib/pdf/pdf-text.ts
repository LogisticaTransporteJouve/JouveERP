"use client";

/** The text of a PDF, read in the browser: each text item on its own line,
 *  page after page. pdfjs is loaded only when a file is read: the library
 *  and its worker both from pdfjs-dist, so their versions match (react-pdf
 *  bundles another pdfjs, and a worker of another version never answers). */
export async function readPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join("\n"),
      );
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

/** The text of a PDF as it reads on the page: the items of one row (same
 *  height) joined left to right, row after row, page after page. A bank's
 *  statement table reads row by row this way. */
export async function readPdfLines(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const rows = new Map<number, { x: number; s: string }[]>();
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const y = Math.round(item.transform[5] ?? 0);
        rows.set(y, [
          ...(rows.get(y) ?? []),
          { x: item.transform[4] ?? 0, s: item.str },
        ]);
      }
      for (const [, items] of [...rows].sort((a, b) => b[0] - a[0])) {
        out.push(
          items
            .sort((a, b) => a.x - b.x)
            .map((i) => i.s)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        );
      }
    }
    return out;
  } finally {
    await task.destroy();
  }
}
