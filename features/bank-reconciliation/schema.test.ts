import { describe, expect, it } from "vitest";

import {
  CreateLineTaxPaymentSchema,
  CreateLineTransactionSchema,
  IgnoreLineSchema,
  MatchLineSchema,
  MatchLinesToMovementSchema,
  ReconciliationQuerySchema,
  isStatementLineStatus,
} from "./schema";

const ID = "6f1c9f0e-3b5d-4c2a-9e8f-1a2b3c4d5e6f";

describe("ReconciliationQuerySchema", () => {
  it("takes an account and a period of up to a year", () => {
    expect(
      ReconciliationQuerySchema.safeParse({
        account_id: ID,
        from: "2026-10-01",
        to: "2026-10-31",
      }).success,
    ).toBe(true);
    expect(
      ReconciliationQuerySchema.safeParse({
        account_id: ID,
        from: "2026-10-31",
        to: "2026-10-01",
      }).success,
    ).toBe(false);
    expect(
      ReconciliationQuerySchema.safeParse({
        account_id: ID,
        from: "2024-01-01",
        to: "2026-01-01",
      }).success,
    ).toBe(false);
  });
});

describe("line writes", () => {
  it("a match takes 1 to 100 movements", () => {
    expect(
      MatchLineSchema.safeParse({ line_id: ID, transaction_ids: [] }).success,
    ).toBe(false);
    expect(
      MatchLineSchema.safeParse({ line_id: ID, transaction_ids: [ID] }).success,
    ).toBe(true);
  });

  it("no corresponde needs a reason", () => {
    expect(
      IgnoreLineSchema.safeParse({ line_id: ID, reason: "  " }).success,
    ).toBe(false);
    expect(
      IgnoreLineSchema.safeParse({ line_id: ID, reason: "Duplicado" }).success,
    ).toBe(true);
  });

  it("creating a movement reads empty ids as none", () => {
    const parsed = CreateLineTransactionSchema.parse({
      line_id: ID,
      channel_id: "jouve_fiscal",
      expense_account_id: "",
      cost_center_id: "",
      description: "",
    });
    expect(parsed).toMatchObject({
      expense_account_id: null,
      cost_center_id: null,
      description: null,
    });
  });
});

describe("isStatementLineStatus", () => {
  it("knows the three statuses", () => {
    expect(isStatementLineStatus("open")).toBe(true);
    expect(isStatementLineStatus("matched")).toBe(true);
    expect(isStatementLineStatus("ignored")).toBe(true);
    expect(isStatementLineStatus("closed")).toBe(false);
  });
});

describe("CreateLineTaxPaymentSchema", () => {
  it("needs the tax document and defaults to the exact amount", () => {
    expect(
      CreateLineTaxPaymentSchema.parse({ line_id: ID, tax_document_id: ID }),
    ).toEqual({ line_id: ID, tax_document_id: ID, allow_difference: false });
    const res = CreateLineTaxPaymentSchema.safeParse({
      line_id: ID,
      tax_document_id: "",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toBe("Elegí el impuesto.");
    }
  });
});

describe("MatchLinesToMovementSchema", () => {
  it("takes one to 100 lines and the movement", () => {
    expect(
      MatchLinesToMovementSchema.safeParse({
        line_ids: [ID, ID],
        transaction_id: ID,
      }).success,
    ).toBe(true);
    expect(
      MatchLinesToMovementSchema.safeParse({ line_ids: [], transaction_id: ID })
        .success,
    ).toBe(false);
    expect(
      MatchLinesToMovementSchema.safeParse({
        line_ids: Array.from({ length: 101 }, () => ID),
        transaction_id: ID,
      }).success,
    ).toBe(false);
  });
});
