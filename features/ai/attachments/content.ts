import "server-only";

import type { UIMessage } from "ai";
import { z } from "zod";

import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";

import { parseCsv, type ParsedTable } from "./csv";
import {
  attachmentsNewestFirst,
  selectWithinBudget,
  tableText,
  type AttachmentContent,
} from "./expand";
import {
  CHAT_ATTACHMENT_BUDGET,
  XLSX_MIME,
  type AttachmentBudget,
} from "./limits";
import { readXlsxFirstSheet } from "./xlsx";

/** A linked chat attachment as stored (store.ts). */
export type StoredAttachment = {
  fileId: string;
  mimeType: string;
  size: number;
  /** PDFs: page count when known. */
  pages: number | null;
  /** Spreadsheets: row count read at upload. */
  rows: number | null;
  /** Spreadsheets: the table read at upload (files.metadata), when it fit. */
  table: ParsedTable | null;
  /** The model API refused it once; it is never sent again. */
  unreadable: boolean;
  bucket: string;
  bucketPath: string;
};

/** Port: the bytes of a stored object, or null when it can't be read. */
export type DownloadFile = (
  bucket: string,
  path: string,
) => Promise<Uint8Array | null>;

export function isTableMime(mime: string): boolean {
  return mime === "text/csv" || mime === XLSX_MIME;
}

export function parseTable(mime: string, bytes: Uint8Array): ParsedTable {
  if (mime === XLSX_MIME) return readXlsxFirstSheet(bytes);
  return parseCsv(new TextDecoder("utf-8").decode(bytes));
}

/** Larger tables are not cached in files.metadata (parsed on demand). */
const MAX_CACHED_TABLE_CHARS = 200_000;

/** files.metadata for a new upload: page count, or the parsed table. */
export function attachmentMetadata(input: {
  pages: number | null;
  table: ParsedTable | null;
}): { [key: string]: Json } {
  if (input.table) {
    const rows = input.table.rows.length;
    const cacheable =
      JSON.stringify(input.table.rows).length <= MAX_CACHED_TABLE_CHARS;
    return cacheable
      ? {
          rows,
          table: { rows: input.table.rows, truncated: input.table.truncated },
        }
      : { rows };
  }
  return input.pages === null ? {} : { pages: input.pages };
}

const MetadataSchema = z.object({
  pages: z.number().int().nonnegative().optional(),
  rows: z.number().int().nonnegative().optional(),
  unreadable: z.boolean().optional(),
  table: z
    .object({ rows: z.array(z.array(z.string())), truncated: z.boolean() })
    .optional(),
});

/** The fields of files.metadata the chat reads. */
export function readAttachmentMetadata(
  metadata: Json,
): Pick<StoredAttachment, "pages" | "rows" | "table" | "unreadable"> {
  const parsed = MetadataSchema.safeParse(metadata);
  const m = parsed.success ? parsed.data : {};
  return {
    pages: m.pages ?? null,
    rows: m.rows ?? null,
    table: m.table ?? null,
    unreadable: m.unreadable ?? false,
  };
}

/**
 * One attachment's content: the file as base64, or its table (cached at
 * upload, else downloaded and parsed). Never throws.
 */
export async function loadOneAttachment(
  row: StoredAttachment,
  download: DownloadFile,
): Promise<AttachmentContent> {
  if (row.unreadable) return { kind: "omitted", reason: "unreadable" };
  if (isTableMime(row.mimeType) && row.table) {
    return { kind: "table", ...row.table };
  }
  const bytes = await download(row.bucket, row.bucketPath);
  if (!bytes) return { kind: "omitted", reason: "missing" };
  if (!isTableMime(row.mimeType)) {
    return {
      kind: "file",
      mediaType: row.mimeType,
      base64: Buffer.from(bytes).toString("base64"),
    };
  }
  try {
    return { kind: "table", ...parseTable(row.mimeType, bytes) };
  } catch (error) {
    logger.warn("ai.attachments.table_unreadable", {
      fileId: row.fileId,
      error,
    });
    return { kind: "omitted", reason: "unreadable" };
  }
}

/**
 * What the model gets this turn for every attachment in `messages`. Files in
 * `send` (attached this turn, or named by the user) go with their content,
 * newest first within the budget; the rest as a note with their size, which
 * the model can open with openAttachment. Only files `stored` knows (linked
 * to this session) are read. Never throws.
 */
export async function loadAttachmentContents(
  messages: readonly UIMessage[],
  stored: ReadonlyMap<string, StoredAttachment>,
  download: DownloadFile,
  options: { send: ReadonlySet<string>; budget?: AttachmentBudget },
): Promise<Map<string, AttachmentContent>> {
  const budget = options.budget ?? CHAT_ATTACHMENT_BUDGET;
  const contents = new Map<string, AttachmentContent>();
  const toSend: StoredAttachment[] = [];
  for (const att of attachmentsNewestFirst(messages)) {
    const row = stored.get(att.fileId);
    if (!row) {
      contents.set(att.fileId, { kind: "omitted", reason: "missing" });
    } else if (row.unreadable) {
      contents.set(att.fileId, { kind: "omitted", reason: "unreadable" });
    } else if (!options.send.has(att.fileId)) {
      contents.set(att.fileId, {
        kind: "summary",
        pages: row.pages,
        rows: row.rows,
      });
    } else {
      toSend.push(row);
    }
  }

  const included = selectWithinBudget(
    toSend.map((row) => ({
      fileId: row.fileId,
      size: row.size,
      pages: row.pages,
      isTable: isTableMime(row.mimeType),
    })),
    budget,
  );

  let tableChars = 0;
  for (const row of toSend) {
    if (!included.has(row.fileId)) {
      contents.set(row.fileId, { kind: "omitted", reason: "budget" });
      continue;
    }
    const content = await loadOneAttachment(row, download);
    if (content.kind === "table") {
      const chars = tableText(content.rows, content.truncated).length;
      if (tableChars + chars > budget.tableChars) {
        contents.set(row.fileId, { kind: "omitted", reason: "budget" });
        continue;
      }
      tableChars += chars;
    }
    contents.set(row.fileId, content);
  }
  return contents;
}

/** Bytes and PDF pages the files sent with the messages already take. */
export function usedBudget(
  contents: ReadonlyMap<string, AttachmentContent>,
  stored: ReadonlyMap<string, StoredAttachment>,
): { bytes: number; pdfPages: number } {
  let bytes = 0;
  let pdfPages = 0;
  for (const [fileId, content] of contents) {
    const row = stored.get(fileId);
    if (content.kind !== "file" || !row) continue;
    bytes += row.size;
    pdfPages += row.pages ?? 0;
  }
  return { bytes, pdfPages };
}
