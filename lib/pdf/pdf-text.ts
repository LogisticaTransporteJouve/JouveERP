"use client";

import type { TextContent } from "pdfjs-dist/types/src/display/api";

/** Each page's text content of a PDF read in the browser. pdfjs is loaded
 *  only when a file is read: the library and its worker both from
 *  pdfjs-dist, so their versions match (a worker of another version never
 *  answers). */
async function readPages(file: File): Promise<TextContent[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const doc = await task.promise;
  try {
    const pages: TextContent[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      pages.push(await (await doc.getPage(n)).getTextContent());
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** The text of a PDF: each text item on its own line, page after page. */
export async function readPdfText(file: File): Promise<string> {
  const pages = await readPages(file);
  return pages
    .map((content) =>
      content.items.map((item) => ("str" in item ? item.str : "")).join("\n"),
    )
    .join("\n");
}

/** The text of a PDF as it reads on the page: the items of one row (same
 *  height) joined left to right, row after row, page after page. A bank's
 *  statement table reads row by row this way. */
export async function readPdfLines(file: File): Promise<string[]> {
  const out: string[] = [];
  for (const content of await readPages(file)) {
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
}
