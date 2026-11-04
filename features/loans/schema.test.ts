import { describe, expect, it } from "vitest";

import { UpdateInstallmentSchema, canCancelLoan } from "./schema";

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

// A cuota saved at $0 drops out of the schedule (w7-s6 F3).
describe("UpdateInstallmentSchema", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const zeroSplit = {
    capital: 0,
    interest: 0,
    iva: 0,
    perception: 0,
    other: 0,
  };

  it("refuses an amount of 0", () => {
    expect(UpdateInstallmentSchema.safeParse({ id, amount: 0 }).success).toBe(
      false,
    );
  });

  it("refuses a split that sums to 0", () => {
    expect(
      UpdateInstallmentSchema.safeParse({ id, split: zeroSplit }).success,
    ).toBe(false);
  });

  it("takes a positive amount, a positive split and removing the split", () => {
    expect(UpdateInstallmentSchema.safeParse({ id, amount: 10 }).success).toBe(
      true,
    );
    expect(
      UpdateInstallmentSchema.safeParse({
        id,
        split: { ...zeroSplit, interest: 5 },
      }).success,
    ).toBe(true);
    expect(UpdateInstallmentSchema.safeParse({ id, split: null }).success).toBe(
      true,
    );
  });
});
