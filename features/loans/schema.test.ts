import { describe, expect, it } from "vitest";

import { Constants } from "@/lib/db/database.types";

import {
  InstallmentSplitSchema,
  LOAN_KINDS,
  LOAN_KIND_LABEL,
  UpdateInstallmentSchema,
  canCancelLoan,
  isLoanKind,
  splitTotal,
} from "./schema";

describe("LOAN_KINDS", () => {
  it("lists exactly the database enum loan_kind", () => {
    expect([...LOAN_KINDS].sort()).toEqual(
      [...Constants.public.Enums.loan_kind].sort(),
    );
  });

  it("names the savings plan", () => {
    expect(isLoanKind("plan_ahorro")).toBe(true);
    expect(LOAN_KIND_LABEL.plan_ahorro).toBe("Plan de ahorro");
  });
});

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
    iva_perception: 0,
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

describe("IVA and IIBB perception of a cuota", () => {
  const split = {
    capital: 1000,
    interest: 0,
    iva: 0,
    perception: 50,
    iva_perception: 100,
    other: 0,
  };

  it("counts both perceptions in the cuota's amount", () => {
    expect(splitTotal(split)).toBe(1150);
  });

  it("reads a split without the IVA part as none", () => {
    const older = {
      capital: 1000,
      interest: 0,
      iva: 0,
      perception: 50,
      other: 0,
    };
    expect(InstallmentSplitSchema.parse(older).iva_perception).toBe(0);
  });
});
