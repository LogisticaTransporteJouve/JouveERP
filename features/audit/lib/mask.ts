import type { JsonValue } from "@/lib/actions/audit";

/** Words of a key whose value identifies a bank account or a person's tax id:
 *  the last four characters stay, so two values can still be told apart. */
const PARTIAL_WORDS = new Set(["cbu", "cvu", "cuil"]);

/** Words of a key whose value is a secret: nothing of it is shown. */
const SECRET_WORDS = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "credentials",
  "signature",
  "key",
  "apikey",
  "cert",
  "certificate",
  "private",
  "pfx",
  "p12",
]);

export const MASK = "••••";

/** `accessToken`, `access-token` and `ACCESS_TOKEN` → ["access", "token"]. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

type Sensitivity = "secret" | "partial" | null;

function sensitivity(key: string): Sensitivity {
  const words = keyWords(key);
  if (words.some((w) => SECRET_WORDS.has(w))) return "secret";
  if (words.some((w) => PARTIAL_WORDS.has(w))) return "partial";
  return null;
}

/** Whether a payload key's value is masked on screen and in the export. */
export function isSensitiveKey(key: string): boolean {
  return sensitivity(key) !== null;
}

function maskValue(value: JsonValue, keepTail: boolean): JsonValue {
  if (value === null) return null;
  if (keepTail && typeof value === "string" && value.length > 4) {
    return `${MASK}${value.slice(-4)}`;
  }
  // Numbers, booleans and whole objects or lists under the key go too.
  return MASK;
}

/**
 * A copy of `value` with the values under sensitive keys masked, by key name
 * and at any depth. Applied on the server, so the browser never receives
 * them.
 */
export function maskSensitive(value: JsonValue | undefined): JsonValue {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v));
  if (typeof value !== "object") return value;
  const out: { [k: string]: JsonValue } = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined) continue;
    const kind = sensitivity(key);
    out[key] =
      kind === null
        ? maskSensitive(inner)
        : maskValue(inner, kind === "partial");
  }
  return out;
}
