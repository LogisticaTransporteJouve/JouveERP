import { describe, expect, it } from "vitest";

import { resolveDeclaredKind } from "./declared-kind";

describe("resolveDeclaredKind", () => {
  it("takes the classifier's more specific type within the same family", () => {
    expect(
      resolveDeclaredKind("purchase_invoice", {
        type: "credit_debit_note",
        confidence: 0.9,
      }),
    ).toEqual({ kind: "credit_debit_note", confidence: 0.9 });
  });

  it("keeps the classifier's confidence when it agrees", () => {
    expect(
      resolveDeclaredKind("purchase_invoice", {
        type: "purchase_invoice",
        confidence: 0.65,
      }),
    ).toEqual({ kind: "purchase_invoice", confidence: 0.65 });
  });

  it("reports a confidently different document", () => {
    expect(
      resolveDeclaredKind("purchase_invoice", {
        type: "check",
        confidence: 0.95,
      }),
    ).toEqual({ kind: "check", confidence: 0.95 });
  });

  it("keeps the declared type, flagged low, on a doubtful disagreement", () => {
    expect(
      resolveDeclaredKind("purchase_invoice", {
        type: "receipt",
        confidence: 0.6,
      }),
    ).toEqual({ kind: "purchase_invoice", confidence: 0.4 });
  });
});
