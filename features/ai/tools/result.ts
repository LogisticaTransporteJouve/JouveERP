/**
 * Result envelope every AI read tool returns to the model: a compact,
 * human-readable `summary` (token-disciplined) plus the structured `data`
 * (which the UI can render as an inline artifact). On failure the model
 * receives the error string and can adapt or explain — tools never throw.
 */
export type AiToolResult =
  | { ok: true; summary: string; data: unknown }
  | { ok: false; summary: string; error: string };

export function okResult(summary: string, data: unknown): AiToolResult {
  return { ok: true, summary, data };
}

export function errResult(error: string): AiToolResult {
  return { ok: false, summary: `No se pudo completar: ${error}`, error };
}

/** Money formatter for tool summaries (es-AR, no decimals). */
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
