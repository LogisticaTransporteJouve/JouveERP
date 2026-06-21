import { describe, expect, it } from "vitest";

import {
  RecurringPaymentCreateSchema,
  isRecurringCategory,
  isRecurringFrequency,
} from "./schema";

describe("RecurringPaymentCreateSchema", () => {
  const base = {
    description: "Alquiler depósito",
    category: "alquiler",
    amount: 150000,
    frequency: "monthly",
    next_due_date: "2026-07-01",
  };

  it("accepts a valid payment and defaults currency to ARS", () => {
    const r = RecurringPaymentCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("ARS");
  });

  it("coerces amount and rejects non-positive", () => {
    expect(
      RecurringPaymentCreateSchema.safeParse({ ...base, amount: "200" }).success,
    ).toBe(true);
    expect(
      RecurringPaymentCreateSchema.safeParse({ ...base, amount: 0 }).success,
    ).toBe(false);
  });

  it("normalizes empty optional fields to null", () => {
    const r = RecurringPaymentCreateSchema.safeParse({
      ...base,
      end_date: "",
      account_id: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.end_date).toBeNull();
      expect(r.data.account_id).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  it("rejects an end date before the next due date", () => {
    expect(
      RecurringPaymentCreateSchema.safeParse({
        ...base,
        end_date: "2026-06-01",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(
      RecurringPaymentCreateSchema.safeParse({ ...base, category: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("guards", () => {
  it("narrow enums", () => {
    expect(isRecurringCategory("sueldo")).toBe(true);
    expect(isRecurringCategory("x")).toBe(false);
    expect(isRecurringFrequency("monthly")).toBe(true);
    expect(isRecurringFrequency("daily")).toBe(false);
  });
});
