import { capTable, type ParsedTable, type TableLimits } from "./csv";
import { excelSerialToIso, XlsxReadError } from "./xlsx";

// The old binary Excel (.xls, BIFF8 inside an OLE compound file) that some
// banks still export, Macro's "Últimos movimientos" among them. Only what a
// table needs: the first sheet's strings, numbers and dates.

const END_OF_CHAIN = 0xfffffffa;

function compoundStream(
  bytes: Uint8Array,
  names: readonly string[],
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0xe011cfd0)
    throw new XlsxReadError("not an xls");
  const sectorSize = 1 << view.getUint16(30, true);
  const miniSize = 1 << view.getUint16(32, true);
  const fatSectors = view.getUint32(44, true);
  const dirStart = view.getUint32(48, true);
  const cutoff = view.getUint32(56, true);
  const miniFatStart = view.getUint32(60, true);
  let difatNext = view.getUint32(68, true);
  const difatCount = view.getUint32(72, true);
  const sector = (i: number) =>
    bytes.subarray(512 + i * sectorSize, 512 + (i + 1) * sectorSize);
  const u32s = (b: Uint8Array) => {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return Array.from({ length: b.byteLength / 4 }, (_, i) =>
      v.getUint32(i * 4, true),
    );
  };

  const difat = u32s(bytes.subarray(76, 512));
  for (let n = 0; n < difatCount && difatNext < END_OF_CHAIN; n++) {
    const words = u32s(sector(difatNext));
    difat.push(...words.slice(0, -1));
    difatNext = words[words.length - 1]!;
  }
  const fat = difat.slice(0, fatSectors).flatMap((s) => u32s(sector(s)));
  const chain = (start: number) => {
    const parts: Uint8Array[] = [];
    for (
      let s = start, guard = 0;
      s < END_OF_CHAIN && guard <= fat.length;
      s = fat[s]!, guard++
    ) {
      parts.push(sector(s));
    }
    return concat(parts);
  };

  const dir = chain(dirStart);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: { name: string; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dir.byteLength; o += 128) {
    const nameLength = dv.getUint16(o + 64, true);
    const name = new TextDecoder("utf-16le").decode(
      dir.subarray(o, o + Math.max(nameLength - 2, 0)),
    );
    entries.push({
      name,
      start: dv.getUint32(o + 116, true),
      size: dv.getUint32(o + 120, true),
    });
  }
  const entry = entries.find((e) => names.includes(e.name));
  if (!entry) throw new XlsxReadError("missing workbook stream");
  if (entry.size >= cutoff) return chain(entry.start).subarray(0, entry.size);

  const ministream = chain(entries[0]!.start);
  const miniFat = u32s(chain(miniFatStart));
  const parts: Uint8Array[] = [];
  for (
    let s = entry.start, guard = 0;
    s < END_OF_CHAIN && guard <= miniFat.length;
    s = miniFat[s]!, guard++
  ) {
    parts.push(ministream.subarray(s * miniSize, (s + 1) * miniSize));
  }
  return concat(parts).subarray(0, entry.size);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

type Record = { type: number; data: Uint8Array };

function records(stream: Uint8Array): Record[] {
  const out: Record[] = [];
  const v = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  for (let i = 0; i + 4 <= stream.byteLength;) {
    const type = v.getUint16(i, true);
    const length = v.getUint16(i + 2, true);
    out.push({ type, data: stream.subarray(i + 4, i + 4 + length) });
    i += 4 + length;
  }
  return out;
}

const latin1 = new TextDecoder("latin1");
const utf16 = new TextDecoder("utf-16le");

/** The shared strings: SST and its CONTINUE records, where a string's
 *  characters may break into the next record with a new width flag. */
function sharedStrings(recs: readonly Record[]): string[] {
  const at = recs.findIndex((r) => r.type === 0x00fc);
  if (at < 0) return [];
  const blocks = [recs[at]!.data];
  for (let j = at + 1; j < recs.length && recs[j]!.type === 0x003c; j++) {
    blocks.push(recs[j]!.data);
  }
  let block = 0;
  let p = 8;
  let data = blocks[0]!;
  const count = new DataView(data.buffer, data.byteOffset).getUint32(4, true);
  const next = () => {
    block += 1;
    data = blocks[block] ?? new Uint8Array();
    p = 0;
  };
  const byte = () => {
    if (p >= data.byteLength) next();
    return data[p++]!;
  };
  const u16 = () => byte() | (byte() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const out: string[] = [];
  for (let n = 0; n < count && block < blocks.length; n++) {
    let left = u16();
    const flags = byte();
    let wide = (flags & 1) === 1;
    const runs = flags & 8 ? u16() : 0;
    const ext = flags & 4 ? u32() : 0;
    let text = "";
    while (left > 0) {
      if (p >= data.byteLength) {
        next();
        wide = (data[p++]! & 1) === 1;
      }
      const width = wide ? 2 : 1;
      const take = Math.min(left, Math.floor((data.byteLength - p) / width));
      const chunk = data.subarray(p, p + take * width);
      text += wide ? utf16.decode(chunk) : latin1.decode(chunk);
      p += take * width;
      left -= take;
    }
    out.push(text);
    for (let k = 0; k < runs * 4 + ext; k++) byte();
  }
  return out;
}

function rk(value: number): number {
  const scaled = (value & 1) === 1;
  let n: number;
  if (value & 2) n = value >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, value & 0xfffffffc, true);
    n = buf.getFloat64(0, true);
  }
  return scaled ? n / 100 : n;
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47,
]);

/** The first sheet of an .xls as a text table, like readXlsxFirstSheet. */
export function readXlsFirstSheet(
  bytes: Uint8Array,
  limits: TableLimits,
): ParsedTable {
  const stream = compoundStream(bytes, ["Workbook", "Book"]);
  const recs = records(stream);
  const strings = sharedStrings(recs);

  const formats = new Map<number, string>();
  const xfFormat: number[] = [];
  for (const r of recs) {
    const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    if (r.type === 0x041e && r.data.byteLength >= 5) {
      const length = v.getUint16(2, true);
      const wide = (r.data[4]! & 1) === 1;
      const body = r.data.subarray(5, 5 + length * (wide ? 2 : 1));
      formats.set(
        v.getUint16(0, true),
        wide ? utf16.decode(body) : latin1.decode(body),
      );
    } else if (r.type === 0x00e0 && r.data.byteLength >= 4) {
      xfFormat.push(v.getUint16(2, true));
    }
  }
  const isDate = (xf: number) => {
    const id = xfFormat[xf];
    if (id === undefined) return false;
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = formats.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, "") ?? "";
    return /[dy]/i.test(code);
  };

  // The first worksheet: the cells between the second BOF and its EOF.
  const bofs = recs.flatMap((r, i) => (r.type === 0x0809 ? [i] : []));
  const from = bofs[1] ?? 0;
  const cells = new Map<number, Map<number, string>>();
  const put = (row: number, col: number, value: string) => {
    if (row > limits.rows + 1 || col >= limits.columns * 2) return;
    let r = cells.get(row);
    if (!r) cells.set(row, (r = new Map()));
    r.set(col, value);
  };
  const number = (row: number, col: number, xf: number, n: number) =>
    put(row, col, isDate(xf) ? excelSerialToIso(n) : String(n));
  for (let i = from + 1; i < recs.length && recs[i]!.type !== 0x000a; i++) {
    const { type, data } = recs[i]!;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.byteLength < 6) continue;
    const row = v.getUint16(0, true);
    const col = v.getUint16(2, true);
    const xf = v.getUint16(4, true);
    if (type === 0x00fd) put(row, col, strings[v.getUint32(6, true)] ?? "");
    else if (type === 0x0203) number(row, col, xf, v.getFloat64(6, true));
    else if (type === 0x027e) number(row, col, xf, rk(v.getUint32(6, true)));
    else if (type === 0x00bd) {
      const n = (data.byteLength - 6) / 6;
      for (let k = 0; k < n; k++) {
        const kxf = v.getUint16(4 + k * 6, true);
        number(row, col + k, kxf, rk(v.getUint32(6 + k * 6, true)));
      }
    } else if (type === 0x0204) {
      const length = v.getUint16(6, true);
      put(row, col, latin1.decode(data.subarray(9, 9 + length)));
    }
  }

  const rows: string[][] = [...cells.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const out: string[] = [];
      for (const [c, value] of [...cells.get(r)!].sort((a, b) => a[0] - b[0])) {
        while (out.length < c) out.push("");
        out[c] = value;
      }
      return out;
    });
  return capTable(rows, limits, rows.length > limits.rows + 1);
}
