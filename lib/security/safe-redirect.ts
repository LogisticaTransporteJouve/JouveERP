const PROBE_ORIGIN = "http://same-origin.invalid";
const MAX_LENGTH = 2048;
// C0 controls, DEL and C1 controls. Browsers strip tab/CR/LF inside URLs, so
// "/\t/evil.com" would otherwise collapse into the protocol-relative "//evil.com".
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Returns `value` when it is a same-origin path ("/dashboard?x=1"), or null.
 * Rejects protocol-relative ("//evil.com"), backslash ("/\evil.com", which
 * browsers treat as "//"), absolute URLs, control characters, and anything
 * whose resolved origin differs from the current one.
 */
export function safeRedirectPath(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (CONTROL_CHARS.test(value)) return null;

  let resolved: URL;
  try {
    resolved = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (resolved.origin !== PROBE_ORIGIN) return null;
  return value;
}
