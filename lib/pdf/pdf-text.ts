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
