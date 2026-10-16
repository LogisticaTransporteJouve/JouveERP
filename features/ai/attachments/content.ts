import "server-only";

import type { UIMessage } from "ai";

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
  pages: number | null;
  bucket: string;
  bucketPath: string;
};

/** Port: the bytes of a stored object, or null when it can't be read. */
export type DownloadFile = (
  bucket: string,
  path: string,
) => Promise<Uint8Array | null>;

function isTableMime(mime: string): boolean {
  return mime === "text/csv" || mime === XLSX_MIME;
}

export function parseTable(mime: string, bytes: Uint8Array): ParsedTable {
  if (mime === XLSX_MIME) return readXlsxFirstSheet(bytes);
  return parseCsv(new TextDecoder("utf-8").decode(bytes));
}

/**
 * The content of every attachment in `messages` for this turn: newest first
 * within CHAT_ATTACHMENT_BUDGET, only files `stored` knows (linked to this
 * session), the rest as an omitted note. Never throws: a failed download or
 * parse becomes `unreadable`.
 */
export async function loadAttachmentContents(
  messages: readonly UIMessage[],
  stored: ReadonlyMap<string, StoredAttachment>,
  download: DownloadFile,
  budget: AttachmentBudget = CHAT_ATTACHMENT_BUDGET,
): Promise<Map<string, AttachmentContent>> {
  const contents = new Map<string, AttachmentContent>();
  const known = attachmentsNewestFirst(messages).flatMap((att) => {
    const row = stored.get(att.fileId);
    if (!row) {
      contents.set(att.fileId, { kind: "omitted", reason: "missing" });
      return [];
    }
    return [row];
  });

  const included = selectWithinBudget(
    known.map((row) => ({
      fileId: row.fileId,
      size: row.size,
      pages: row.pages,
      isTable: isTableMime(row.mimeType),
    })),
    budget,
  );

  let tableChars = 0;
  for (const row of known) {
    if (!included.has(row.fileId)) {
      contents.set(row.fileId, { kind: "omitted", reason: "budget" });
      continue;
    }
    const bytes = await download(row.bucket, row.bucketPath);
    if (!bytes) {
      contents.set(row.fileId, { kind: "omitted", reason: "missing" });
      continue;
    }
    if (!isTableMime(row.mimeType)) {
      contents.set(row.fileId, {
        kind: "file",
        mediaType: row.mimeType,
        base64: Buffer.from(bytes).toString("base64"),
      });
      continue;
    }
    try {
      const table = parseTable(row.mimeType, bytes);
      const chars = tableText(table.rows, table.truncated).length;
      if (tableChars + chars > budget.tableChars) {
        contents.set(row.fileId, { kind: "omitted", reason: "budget" });
        continue;
      }
      tableChars += chars;
      contents.set(row.fileId, { kind: "table", ...table });
    } catch (error) {
      logger.warn("ai.attachments.table_unreadable", {
        fileId: row.fileId,
        error,
      });
      contents.set(row.fileId, { kind: "omitted", reason: "unreadable" });
    }
  }
  return contents;
}
