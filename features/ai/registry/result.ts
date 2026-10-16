/**
 * What an action's `run` returns: a compact, human-readable `summary`
 * (token-disciplined) plus the structured `data` the UI can render as an
 * inline artifact, and whether the figures are partial (a page, a cap, a
 * truncated read). On failure the model receives the error string and can
 * adapt or explain — runs never throw.
 */
export type AiRunResult =
  | {
      ok: true;
      summary: string;
      data: unknown;
      partial?: boolean;
      currency?: string;
      exchangeRate?: { currency: string; rate: number; date: string };
      note?: string;
    }
  | AiErrorResult;

export type AiErrorResult = { ok: false; summary: string; error: string };

/** Provenance every successful tool result carries to the model. */
export type AiToolMeta = {
  /** Tables, views or RPCs the figures come from. */
  sources: readonly string[];
  /** When the server computed the result (ISO timestamp). */
  asOf: string;
  /** True when the figures do not cover the whole requested set. */
  partial: boolean;
  currency?: string;
  exchangeRate?: { currency: string; rate: number; date: string };
  note?: string;
};

/** What the model receives: the run result plus `meta` on success. */
export type AiToolResult =
  | { ok: true; summary: string; data: unknown; meta: AiToolMeta }
  | AiErrorResult;

type OkExtras = {
  partial?: boolean;
  currency?: string;
  exchangeRate?: { currency: string; rate: number; date: string };
  note?: string;
};

export function okResult(
  summary: string,
  data: unknown,
  extras: OkExtras = {},
): AiRunResult {
  return { ok: true, summary, data, ...extras };
}

export function errResult(error: string): AiErrorResult {
  return { ok: false, summary: `Failed: ${error}`, error };
}

/** PostgREST `max_rows` (supabase/config.toml). A single read that is not
 *  drained page by page and returns this many rows may have been cut. */
export const POSTGREST_MAX_ROWS = 1000;

/** True when a capped read came back full, so rows beyond it may exist. */
export function reachedCap(
  rows: number,
  cap: number = POSTGREST_MAX_ROWS,
): boolean {
  return rows >= cap;
}

/** Money formatter for tool summaries (es-AR, no decimals). */
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
