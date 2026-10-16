import "server-only";

import { inflateSync } from "node:zlib";

// What the upload needs from a PDF, without a PDF library: whether it is
// encrypted (the model can't read it) and its page count. Pages are the
// distinct object numbers whose dictionary is `/Type /Page` (not `/Pages`),
// in the file body and inside Flate-compressed object streams (PDF 1.5+);
// an incremental update that rewrites a page reuses its number, so it is
// counted once. Null when no page object is found: the byte cap still
// bounds the file.

const PAGE_TYPE = /\/Type\s*\/Page(?![a-zA-Z])/;
const OBJECT_HEADER = /(\d+)\s+\d+\s+obj\b/g;
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

/** A trailer or cross-reference stream naming an /Encrypt dictionary. */
export function isEncryptedPdf(bytes: Uint8Array): boolean {
  const raw = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).toString("latin1");
  return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(raw);
}

/** The data of the stream whose `stream` keyword starts at `keyword`. */
function streamData(
  buf: Buffer,
  raw: string,
  dict: string,
  keyword: number,
): Buffer | null {
  const eol = raw.startsWith("stream\r\n", keyword) ? 8 : 7;
  const start = keyword + eol;
  const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  if (length) {
    const end = start + Number(length[1]);
    if (end <= buf.length && /^\s*endstream/.test(raw.slice(end, end + 32))) {
      return buf.subarray(start, end);
    }
  }
  const end = raw.indexOf("endstream", start);
  if (end < 0) return null;
  let trimmed = end;
  if (raw[trimmed - 1] === "\n") trimmed--;
  if (raw[trimmed - 1] === "\r") trimmed--;
  return buf.subarray(start, trimmed);
}

/** Page object numbers inside an inflated object stream. */
function pagesInObjectStream(dict: string, content: string): number[] {
  const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0);
  const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0);
  if (!n || !first) return [];
  const header = content.slice(0, first).trim().split(/\s+/).map(Number);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const num = header[i * 2];
    const offset = header[i * 2 + 1];
    if (num === undefined || offset === undefined) break;
    const next = header[i * 2 + 3];
    const body = content.slice(
      first + offset,
      next === undefined ? undefined : first + next,
    );
    if (PAGE_TYPE.test(body)) out.push(num);
  }
  return out;
}

export function countPdfPages(bytes: Uint8Array): number | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = buf.toString("latin1");
  const pages = new Set<number>();
  let inflatedTotal = 0;

  const headers = Array.from(raw.matchAll(OBJECT_HEADER));
  headers.forEach((match, i) => {
    const bodyStart = match.index + match[0].length;
    const nextHeader = headers[i + 1]?.index ?? raw.length;
    const endobj = raw.indexOf("endobj", bodyStart);
    const bodyEnd = endobj >= 0 && endobj < nextHeader ? endobj : nextHeader;
    const body = raw.slice(bodyStart, bodyEnd);
    const streamAt = body.search(/stream\r?\n/);
    const dict = streamAt >= 0 ? body.slice(0, streamAt) : body;
    const num = Number(match[1]);

    if (streamAt < 0) {
      if (PAGE_TYPE.test(dict)) pages.add(num);
      return;
    }
    if (!/\/Type\s*\/ObjStm/.test(dict) || !/\/FlateDecode/.test(dict)) return;
    if (inflatedTotal >= MAX_INFLATED_BYTES) return;
    const data = streamData(buf, raw, dict, bodyStart + streamAt);
    if (!data) return;
    try {
      const inflated = inflateSync(data, {
        maxOutputLength: MAX_INFLATED_BYTES - inflatedTotal,
      });
      inflatedTotal += inflated.length;
      for (const p of pagesInObjectStream(dict, inflated.toString("latin1"))) {
        pages.add(p);
      }
    } catch {
      // A stream that fails to inflate (or hits the cap) is skipped.
    }
  });
  return pages.size > 0 ? pages.size : null;
}
