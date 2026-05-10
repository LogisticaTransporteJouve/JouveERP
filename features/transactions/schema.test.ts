import { describe, expect, it } from "vitest";

import {
  defaultAccrualMonth,
  isTransactionKind,
  TransactionCreateSchema,
  TransactionUpdateSchema,
  TransferCreateSchema,
} from "./schema";

const ACCOUNT_FROM = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ACCOUNT_TO = "0e8400e2-9b8a-4dca-9c44-bb52a8e8feac";
const TX_ID = "1c6a4d3a-c7c8-4d6b-8a0f-2c1d3e4f5a6b";

const validIncome = {
  account_id: ACCOUNT_FROM,
  channel_id: "jouve_fiscal",
  kind: "income" as const,
  amount: 100,
  currency: "ARS" as const,
  transaction_date: "2026-05-10",
  accrual_month: "2026-05-01",
  description: "Cobro factura A0003-00000123",
};

describe("isTransactionKind", () => {
  it("accepts known kinds and rejects others", () => {
    expect(isTransactionKind("income")).toBe(true);
    expect(isTransactionKind("expense")).toBe(true);
    expect(isTransactionKind("transfer_in")).toBe(true);
    expect(isTransactionKind("transfer_out")).toBe(true);
    expect(isTransactionKind("foo")).toBe(false);
    expect(isTransactionKind(undefined)).toBe(false);
  });
});

describe("defaultAccrualMonth", () => {
  it("returns the first day of the month for a YYYY-MM-DD input", () => {
    expect(defaultAccrualMonth("2026-05-10")).toBe("2026-05-01");
    expect(defaultAccrualMonth("2026-01-31")).toBe("2026-01-01");
  });
});

describe("TransactionCreateSchema", () => {
  it("accepts a valid income", () => {
    const r = TransactionCreateSchema.safeParse(validIncome);
    expect(r.success).toBe(true);
  });

  it("accepts a valid expense", () => {
    const r = TransactionCreateSchema.safeParse({
      ...validIncome,
      kind: "expense" as const,
    });
    expect(r.success).toBe(true);
  });

  it("rejects transfer_in/out via this schema (use TransferCreateSchema)", () => {
    const r = TransactionCreateSchema.safeParse({
      ...validIncome,
      kind: "transfer_in" as const,
    });
    expect(r.success).toBe(false);
  });

  it("rejects accrual_month not on day 1", () => {
    const r = TransactionCreateSchema.safeParse({
      ...validIncome,
      accrual_month: "2026-05-15",
    });
    expect(r.success).toBe(false);
  });

  it("rejects amount = 0 or negative", () => {
    expect(
      TransactionCreateSchema.safeParse({ ...validIncome, amount: 0 }).success,
    ).toBe(false);
    expect(
      TransactionCreateSchema.safeParse({ ...validIncome, amount: -10 }).success,
    ).toBe(false);
  });

  it("normalises amount strings with commas", () => {
    const r = TransactionCreateSchema.safeParse({
      ...validIncome,
      amount: "100,50",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(100.5);
  });
});

describe("TransferCreateSchema", () => {
  const validTransfer = {
    account_from_id: ACCOUNT_FROM,
    account_to_id: ACCOUNT_TO,
    channel_id: "jouve_fiscal",
    amount: 500,
    currency: "ARS" as const,
    transaction_date: "2026-05-10",
    accrual_month: "2026-05-01",
    description: "Pase de Caja a Banco",
  };

  it("accepts a valid transfer between distinct accounts", () => {
    const r = TransferCreateSchema.safeParse(validTransfer);
    expect(r.success).toBe(true);
  });

  it("rejects transfer when from == to", () => {
    const r = TransferCreateSchema.safeParse({
      ...validTransfer,
      account_to_id: ACCOUNT_FROM,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues[0]?.message ?? "";
      expect(msg).toMatch(/distintas/);
    }
  });
});

describe("TransactionUpdateSchema", () => {
  it("accepts minimal valid update", () => {
    const r = TransactionUpdateSchema.safeParse({
      id: TX_ID,
      amount: 200,
      transaction_date: "2026-05-11",
      accrual_month: "2026-05-01",
      description: null,
    });
    expect(r.success).toBe(true);
  });
});
