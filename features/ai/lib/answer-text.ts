import { Lexer, type Token, type Tokens } from "marked";

import type {
  ArtifactCell,
  TableArtifact,
  TableColumn,
  ValueFormat,
} from "../artifacts/spec";
import { ARTIFACT_LIMITS } from "../artifacts/spec";

import { TOOL_LABELS } from "./tool-labels";

/** Longest names first, so `getInvoiceDetail` wins over `getInvoices`-like
 *  prefixes; whole words only. */
const TOOL_NAME =
  Object.keys(TOOL_LABELS).length > 0
    ? new RegExp(
        `\`?\\b(${Object.keys(TOOL_LABELS)
          .sort((a, b) => b.length - a.length)
          .join("|")})\\b(?:\\(\\))?\`?`,
        "g",
      )
    : null;

/**
 * Output guard: a tool name that slipped into the answer (bare or as inline
 * code, "(`getTaxDocuments`)") reads as its label ("(Impuestos)").
 */
export function humanizeToolNames(text: string): string {
  if (!TOOL_NAME) return text;
  return text.replace(
    TOOL_NAME,
    (_match, name: string) => TOOL_LABELS[name] ?? name,
  );
}

const EMPTY_CELL = /^(?:—|–|-|n\/a|s\/d)?$/i;
const GROUPED = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
const PLAIN = /^\d+(?:,\d+)?$/;

type ParsedNumber = { value: number; format: ValueFormat };

/** Markdown emphasis and code marks around a cell's text. */
function plainCell(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^[*_](.*)[*_]$/, "$1")
    .replace(/\\\|/g, "|")
    .trim();
}

/**
 * A number as written in es-AR: "$ 1.234.567,89", "-$ 1.234", "($ 500)",
 * "US$ 1.000,50", "21 %", "10,5%", "1.234". Null when the text is not one.
 */
export function parseEsArNumber(raw: string): ParsedNumber | null {
  let s = raw.replace(/[\s ]/g, "").replace(/−/g, "-");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  let format: ValueFormat = "number";
  const currency = /^(US\$|USD|U\$S|\$|ARS)/i.exec(s);
  if (currency?.[1]) {
    format = /^\$|^ARS$/i.test(currency[1]) ? "money" : "usd";
    s = s.slice(currency[1].length);
  } else if (s.endsWith("%")) {
    format = "percent";
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!GROUPED.test(s) && !PLAIN.test(s)) return null;
  const value = Number(s.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, format };
}

/** A column is numeric when every filled cell is a number; it reads as
 *  money, US$ or percent when its numbers say so. */
function columnOf(
  index: number,
  label: string,
  cells: readonly string[],
): { column: TableColumn; values: ArtifactCell[] } {
  const filled = cells.filter((c) => !EMPTY_CELL.test(c));
  const parsed = filled.map(parseEsArNumber);
  const key = `c${index + 1}`;
  if (filled.length === 0 || parsed.some((p) => p === null)) {
    return {
      column: { key, label, numeric: false, format: "text" },
      values: cells.map((c) => (EMPTY_CELL.test(c) ? null : c)),
    };
  }
  const kinds = new Set(
    parsed.flatMap((p) => (p && p.format !== "number" ? [p.format] : [])),
  );
  const [only] = kinds;
  const format: ValueFormat = kinds.size === 1 && only ? only : "number";
  return {
    column: { key, label, numeric: true, format },
    values: cells.map((c) =>
      EMPTY_CELL.test(c) ? null : (parseEsArNumber(c)?.value ?? null),
    ),
  };
}

/** Where a lifted table came from: shown in the canvas, never pinnable (a pin
 *  reruns a query, and this table has none). */
export const ANSWER_TABLE_ACTION = "assistantAnswer";

/** A markdown table of the answer as a table artifact the canvas can show
 *  and export. */
export function answerTableArtifact(
  table: Tokens.Table,
  heading: string | null,
): TableArtifact {
  const headers = table.header
    .slice(0, ARTIFACT_LIMITS.tableColumns)
    .map((h, i) => plainCell(h.text) || `Columna ${i + 1}`);
  const bodyRows = table.rows
    .slice(0, ARTIFACT_LIMITS.tableRows)
    .map((r) => headers.map((_, i) => plainCell(r[i]?.text ?? "")));
  const cols = headers.map((label, i) =>
    columnOf(
      i,
      label.slice(0, ARTIFACT_LIMITS.labelLength),
      bodyRows.map((r) => r[i] ?? ""),
    ),
  );
  const title = (heading ?? headers[0] ?? "Tabla").slice(
    0,
    ARTIFACT_LIMITS.titleLength,
  );
  return {
    kind: "table",
    title,
    source: { action: ANSWER_TABLE_ACTION, input: {} },
    columns: cols.map((c) => c.column),
    rows: bodyRows.map((_, r) => cols.map((c) => c.values[r] ?? null)),
    truncated:
      table.rows.length > ARTIFACT_LIMITS.tableRows ||
      table.header.length > ARTIFACT_LIMITS.tableColumns,
    meta: { sources: [], asOf: "", partial: false },
  };
}

/** A heading, or a paragraph that is only bold text ("**Por alícuota**"),
 *  right before a table names it. */
function headingOf(token: Token | undefined): string | null {
  if (!token) return null;
  if (token.type === "heading") return plainCell(token.text) || null;
  if (token.type === "paragraph") {
    const m = /^\s*\*\*([^*\n]+)\*\*:?\s*$/.exec(token.raw);
    return m?.[1] ? m[1].trim().replace(/:$/, "") : null;
  }
  return null;
}

function isTableToken(token: Token): token is Tokens.Table {
  return token.type === "table";
}

export type AnswerChunk =
  | { kind: "text"; text: string }
  | { kind: "table"; id: string; artifact: TableArtifact };

/**
 * An assistant answer split into its text and its markdown tables, in order.
 * Each table is lifted out as an artifact (the canvas shows it; the message
 * keeps a card), taking the heading right before it as its title. Tool names
 * are humanized first. `idPrefix` keys each table: `${idPrefix}:table${n}`.
 */
export function answerChunks(text: string, idPrefix: string): AnswerChunk[] {
  const clean = humanizeToolNames(text);
  if (!clean.includes("|")) return [{ kind: "text", text: clean }];
  const tokens = new Lexer({ gfm: true }).lex(clean);
  const chunks: AnswerChunk[] = [];
  let pending: Token[] = [];
  let n = 0;
  const flush = () => {
    const raw = pending.map((t) => t.raw).join("");
    if (raw.trim() !== "") chunks.push({ kind: "text", text: raw });
    pending = [];
  };
  for (const token of tokens) {
    if (!isTableToken(token)) {
      pending.push(token);
      continue;
    }
    // The heading is the last non-blank token before the table.
    let at = pending.length - 1;
    while (at >= 0 && pending[at]?.type === "space") at--;
    const heading = headingOf(pending[at]);
    if (heading !== null) pending = pending.slice(0, at);
    flush();
    n += 1;
    chunks.push({
      kind: "table",
      id: `${idPrefix}:table${n}`,
      artifact: answerTableArtifact(token, heading),
    });
  }
  flush();
  return n === 0 ? [{ kind: "text", text: clean }] : chunks;
}
