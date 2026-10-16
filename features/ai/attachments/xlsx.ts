import "server-only";

import { inflateRawSync } from "node:zlib";

import { XMLParser } from "fast-xml-parser";

import { capTable, type ParsedTable } from "./csv";
import { CHAT_TABLE_LIMITS } from "./limits";

// First worksheet of an .xlsx as a text table, without a spreadsheet
// dependency: an .xlsx is a zip of XML parts. Only what a table needs is read
// (workbook, its rels, shared strings, styles for dates, the first sheet).

/** Inflated size cap per zip entry (zip-bomb guard). */
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

export class XlsxReadError extends Error {}

type ZipEntry = { method: number; offset: number; compressedSize: number };

function readZipDirectory(buf: Buffer): Map<string, ZipEntry> {
  const minEocd = 22;
  let eocd = -1;
  for (
    let i = buf.length - minEocd;
    i >= Math.max(0, buf.length - 65_557);
    i--
  ) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new XlsxReadError("corrupt central directory");
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, offset, compressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf: Buffer, entry: ZipEntry): string {
  const p = entry.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new XlsxReadError("corrupt local header");
  }
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    if (data.length > MAX_ENTRY_BYTES)
      throw new XlsxReadError("entry too large");
    return data.toString("utf8");
  }
  if (entry.method === 8) {
    try {
      return inflateRawSync(data, {
        maxOutputLength: MAX_ENTRY_BYTES,
      }).toString("utf8");
    } catch {
      throw new XlsxReadError("entry could not be inflated");
    }
  }
  throw new XlsxReadError(`unsupported compression ${entry.method}`);
}

const ARRAY_TAGS = new Set([
  "sheet",
  "Relationship",
  "si",
  "r",
  "row",
  "c",
  "xf",
  "numFmt",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

function parseXml(xml: string): unknown {
  if (/<!DOCTYPE/i.test(xml)) throw new XlsxReadError("DOCTYPE not allowed");
  const doc: unknown = parser.parse(xml);
  return doc;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function get(value: unknown, ...path: string[]): unknown {
  let cur = value;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Text of a <t> node (a string, or { "#text" } when it has attributes). */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  return str(get(node, "#text"));
}

/** Text of an <si>/<is>: a plain <t> or rich-text runs <r><t>. */
function richText(node: unknown): string {
  const t = get(node, "t");
  if (t !== undefined) return textOf(t);
  return list(get(node, "r"))
    .map((run) => textOf(get(run, "t")))
    .join("");
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47,
]);

/** Indexes of cellXfs whose number format is a date. */
function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const doc = parseXml(stylesXml);
  const custom = new Map<number, string>();
  for (const fmt of list(get(doc, "styleSheet", "numFmts", "numFmt"))) {
    custom.set(
      Number(str(get(fmt, "@_numFmtId"))),
      str(get(fmt, "@_formatCode")),
    );
  }
  list(get(doc, "styleSheet", "cellXfs", "xf")).forEach((xf, index) => {
    const id = Number(str(get(xf, "@_numFmtId")));
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, "") ?? "";
    if (BUILTIN_DATE_FORMATS.has(id) || /[dy]/i.test(code)) out.add(index);
  });
  return out;
}

/** Excel serial date (1900 system) → YYYY-MM-DD. */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolveFirstSheetPath(
  workbookXml: string,
  relsXml: string | null,
): string {
  const fallback = "xl/worksheets/sheet1.xml";
  const first = list(
    get(parseXml(workbookXml), "workbook", "sheets", "sheet"),
  )[0];
  const rid = str(get(first, "@_id"));
  if (!rid || !relsXml) return fallback;
  const rel = list(
    get(parseXml(relsXml), "Relationships", "Relationship"),
  ).find((r) => str(get(r, "@_Id")) === rid);
  const target = str(get(rel, "@_Target"));
  if (!target) return fallback;
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/**
 * The sheet XML up to its `limit`-th row: the rest is never parsed. Reports
 * whether rows were left out.
 */
export function truncateSheetXml(
  xml: string,
  limit: number,
): { xml: string; cut: boolean } {
  let pos = 0;
  for (let i = 0; i < limit; i++) {
    const next = xml.indexOf("</row>", pos);
    if (next < 0) return { xml, cut: false };
    pos = next + "</row>".length;
  }
  const cut = /<row[\s>/]/.test(xml.slice(pos));
  return { xml: `${xml.slice(0, pos)}</sheetData></worksheet>`, cut };
}

/**
 * Only the shared strings at `wanted` indexes: each `<si>` is located by a
 * scan and only those are parsed, so a large string table costs a string
 * search instead of a full DOM.
 */
export function readSharedStrings(
  xml: string,
  wanted: ReadonlySet<number>,
): Map<number, string> {
  const out = new Map<number, string>();
  if (wanted.size === 0) return out;
  if (/<!DOCTYPE/i.test(xml)) throw new XlsxReadError("DOCTYPE not allowed");
  const max = Math.max(...wanted);
  const open = /<si(?=[\s>/])/g;
  let index = 0;
  for (let m = open.exec(xml); m && index <= max; m = open.exec(xml)) {
    const selfClosing = xml.indexOf("/>", m.index);
    const tagEnd = xml.indexOf(">", m.index);
    let segment: string;
    if (selfClosing >= 0 && selfClosing + 1 === tagEnd) {
      segment = "";
      open.lastIndex = tagEnd + 1;
    } else {
      const close = xml.indexOf("</si>", tagEnd);
      if (close < 0) break;
      segment = xml.slice(m.index, close + "</si>".length);
      open.lastIndex = close + "</si>".length;
    }
    if (wanted.has(index)) {
      out.set(
        index,
        segment
          ? richText(
              list(get(parseXml(`<sst>${segment}</sst>`), "sst", "si"))[0],
            )
          : "",
      );
    }
    index++;
  }
  return out;
}

type RawCell = {
  col: number;
  type: string;
  raw: string;
  style: number;
  inline: unknown;
};

/** First worksheet of an .xlsx file as rows of text, capped. */
export function readXlsxFirstSheet(bytes: Uint8Array): ParsedTable {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readZipDirectory(buf);
  const read = (name: string): string | null => {
    const entry = entries.get(name);
    return entry ? readZipEntry(buf, entry) : null;
  };

  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new XlsxReadError("missing workbook");
  const fullSheet = read(
    resolveFirstSheetPath(workbook, read("xl/_rels/workbook.xml.rels")),
  );
  if (!fullSheet) throw new XlsxReadError("missing worksheet");

  const maxRows = CHAT_TABLE_LIMITS.rows + 1;
  const sheet = truncateSheetXml(fullSheet, maxRows);
  const rowNodes = list(
    get(parseXml(sheet.xml), "worksheet", "sheetData", "row"),
  ).slice(0, maxRows);

  const cells: RawCell[][] = rowNodes.map((rowNode) => {
    const out: RawCell[] = [];
    for (const cell of list(get(rowNode, "c"))) {
      const ref = str(get(cell, "@_r"));
      const col = ref ? columnIndex(ref) : out.length;
      if (col < 0 || col >= CHAT_TABLE_LIMITS.columns * 2) continue;
      out.push({
        col,
        type: str(get(cell, "@_t")),
        raw: textOf(get(cell, "v")),
        style: Number(str(get(cell, "@_s"))),
        inline: get(cell, "is"),
      });
    }
    return out;
  });

  const wanted = new Set(
    cells.flat().flatMap((c) => (c.type === "s" ? [Number(c.raw)] : [])),
  );
  const sharedXml = wanted.size > 0 ? read("xl/sharedStrings.xml") : null;
  const shared = sharedXml ? readSharedStrings(sharedXml, wanted) : new Map();
  const dates = dateStyles(read("xl/styles.xml"));

  const rows = cells.map((rowCells) => {
    const row: string[] = [];
    for (const c of rowCells) {
      let value: string;
      if (c.type === "s") value = shared.get(Number(c.raw)) ?? "";
      else if (c.type === "inlineStr") value = richText(c.inline);
      else if (c.type === "b") value = c.raw === "1" ? "VERDADERO" : "FALSO";
      else if (
        c.type === "" &&
        c.raw !== "" &&
        dates.has(c.style) &&
        Number.isFinite(Number(c.raw))
      ) {
        value = excelSerialToIso(Number(c.raw));
      } else value = c.raw;
      while (row.length < c.col) row.push("");
      row[c.col] = value;
    }
    return row;
  });
  return capTable(rows, sheet.cut);
}
