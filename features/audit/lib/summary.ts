import type { JsonValue } from "@/lib/actions/audit";

const MAX_PARTS = 3;
const MAX_TEXT = 40;

type JsonObject = { [k: string]: JsonValue | undefined };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function short(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") {
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return Array.isArray(value) ? `[${value.length}]` : "{…}";
}

function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * One line of what an event changed, from its (already masked) payload:
 * `campo: antes → después` for a `before`/`after` pair, `antes → después` for
 * a `from`/`to` pair, else the first scalar fields. Null for an empty
 * payload.
 */
export function summarizeAuditPayload(payload: JsonValue): string | null {
  if (!isObject(payload)) return null;

  const { before, after } = payload;
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const changed = keys.filter((k) => !same(before[k], after[k]));
    if (changed.length === 0) return "Sin cambios de valores";
    const parts = changed
      .slice(0, MAX_PARTS)
      .map((k) => `${k}: ${short(before[k])} → ${short(after[k])}`);
    const more = changed.length - parts.length;
    return parts.join(" · ") + (more > 0 ? ` (+${more})` : "");
  }
  if ("from" in payload && "to" in payload) {
    return `${short(payload.from)} → ${short(payload.to)}`;
  }

  const parts = Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && !isObject(v))
    .slice(0, MAX_PARTS)
    .map(([k, v]) => `${k}: ${short(v)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
