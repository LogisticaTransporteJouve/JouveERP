import { describe, expect, it } from "vitest";

import { canCancelLoan } from "./schema";

describe("canCancelLoan", () => {
  const loan = {
    status: "active" as const,
    disbursement_transaction_id: null,
    paid_total: 0,
  };

  it("offers the cancel for a loan with nothing recorded", () => {
    expect(canCancelLoan(loan)).toBe(true);
  });

  it("hides it once the disbursement is recorded", () => {
    expect(
      canCancelLoan({ ...loan, disbursement_transaction_id: "tx-1" }),
    ).toBe(false);
  });

  it("hides it once a cuota is paid", () => {
    expect(canCancelLoan({ ...loan, paid_total: 100 })).toBe(false);
  });

  it("hides it for a loan already closed", () => {
    expect(canCancelLoan({ ...loan, status: "paid" })).toBe(false);
  });
});
