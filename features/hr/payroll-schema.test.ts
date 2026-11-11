import { describe, expect, it } from "vitest";

import {
  BulkCreatePayrollPaymentsSchema,
  CreatePayrollPaymentSchema,
} from "./payroll-schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("payroll payments carry no channel", () => {
  it("drops a channel sent by an older client or a stored draft", () => {
    const one = CreatePayrollPaymentSchema.parse({
      entry_id: UUID,
      account_id: UUID,
      channel_id: "jouve_fiscal",
      amount: 1000,
      method: "transferencia",
      paid_at: "2026-11-05",
    });
    expect(one).not.toHaveProperty("channel_id");

    const bulk = BulkCreatePayrollPaymentsSchema.parse({
      items: [{ entry_id: UUID, amount: 1000 }],
      account_id: UUID,
      channel_id: "jouve_internal",
      method: "efectivo",
      paid_at: "2026-11-05",
    });
    expect(bulk).not.toHaveProperty("channel_id");
  });
});
