import "server-only";

import { inflateSync } from "node:zlib";

// Page count of a PDF without a PDF library: count the page objects
// (`/Type /Page`, not `/Pages`) in the file and in its Flate-compressed
// streams, where PDF 1.5+ object streams keep them. Returns null when no page
// object is found (encrypted or unusual files): the byte cap still bounds them.

const PAGE_OBJECT = /\/Type\s*\/Page(?![a-zA-Z])/g;
const STREAM = /stream\r?\n/g;
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

function countPages(text: string): number {
  return text.match(PAGE_OBJECT)?.length ?? 0;
}

export function countPdfPages(bytes: Uint8Array): number | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = buf.toString("latin1");
  let pages = countPages(raw);
  let inflatedTotal = 0;

  for (const match of raw.matchAll(STREAM)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    // Only object streams can hold page dictionaries.
    const dict = raw.slice(Math.max(0, match.index - 300), match.index);
    if (!/\/Type\s*\/ObjStm/.test(dict) || !/\/FlateDecode/.test(dict))
      continue;
    try {
      const inflated = inflateSync(buf.subarray(start, end), {
        maxOutputLength: MAX_INFLATED_BYTES - inflatedTotal,
      });
      inflatedTotal += inflated.length;
      pages += countPages(inflated.toString("latin1"));
    } catch {
      // A stream that fails to inflate (or hits the cap) is skipped.
    }
    if (inflatedTotal >= MAX_INFLATED_BYTES) break;
  }
  return pages > 0 ? pages : null;
}
