import { createHash } from "node:crypto";

/**
 * Identifies a finding by its kind and the records it points at, so a finding
 * the user ignored is not raised again by the next analyst run. Cards with no
 * records (cash-flow, receivables risk) have none: ignoring one hides only
 * that run's card.
 */
export function insightFingerprint(
  kind: string,
  sourceRefs: unknown,
): string | null {
  if (!Array.isArray(sourceRefs)) return null;
  const ids = sourceRefs
    .filter((r): r is string => typeof r === "string" && r.length > 0)
    .sort();
  if (ids.length === 0) return null;
  const digest = createHash("sha256").update(ids.join(",")).digest("hex");
  return `${kind}:${digest}`;
}
