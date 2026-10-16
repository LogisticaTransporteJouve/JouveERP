import type { Classification } from "./schemas";

/** Kinds that load through the same form (a purchase NC/ND is a purchase comprobante). */
const FAMILIES: readonly (readonly string[])[] = [
  ["purchase_invoice", "credit_debit_note"],
];

/** A confident classification that contradicts the declared type wins. */
const OVERRIDE_CONFIDENCE = 0.8;

function sameFamily(a: string, b: string): boolean {
  return a === b || FAMILIES.some((f) => f.includes(a) && f.includes(b));
}

/**
 * Reconciles the type the user declared (by uploading from a given form) with
 * what the classifier sees. Same type or family: the classifier's (more
 * specific) type and confidence. A different type: the classifier's when it is
 * confident (the form reports "not this kind of document"), else the declared
 * one with a low confidence so the reading gets flagged for review.
 */
export function resolveDeclaredKind(
  declared: string,
  classification: Pick<Classification, "type" | "confidence">,
): { kind: string; confidence: number } {
  const { type, confidence } = classification;
  if (sameFamily(declared, type)) return { kind: type, confidence };
  if (confidence >= OVERRIDE_CONFIDENCE) return { kind: type, confidence };
  return {
    kind: declared,
    confidence: Math.round((1 - confidence) * 1000) / 1000,
  };
}
