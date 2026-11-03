import { describe, expect, it } from "vitest";

import {
  ChequeCreateSchema,
  DepositChequeSchema,
  ManualChequeCreateSchema,
  CHECK_STATUS_LABEL,
  RejectChequeSchema,
  SellChequesSchema,
  isChequeStatus,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("ChequeCreateSchema", () => {
  const valid = {
    kind: "fisico" as const,
    check_number: "12345678",
    bank_name: "Banco X",
    drawer_name: "Cliente Y",
    issue_date: "2026-05-01",
    due_date: "2026-06-01",
    amount: 1000,
    currency: "ARS" as const,
    cartera_account_id: UUID,
  };

  it("acepta payload mínimo válido", () => {
    expect(ChequeCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza amount = 0", () => {
    expect(ChequeCreateSchema.safeParse({ ...valid, amount: 0 }).success).toBe(
      false,
    );
  });

  it("rechaza issue_date mal formado", () => {
    expect(
      ChequeCreateSchema.safeParse({ ...valid, issue_date: "01/05/2026" })
        .success,
    ).toBe(false);
  });
});

describe("ManualChequeCreateSchema", () => {
  const valid = {
    kind: "fisico" as const,
    check_number: "12345678",
    bank_name: "Banco X",
    drawer_name: "Cliente Y",
    issue_date: "2026-05-01",
    due_date: "2026-06-01",
    amount: 1000,
    currency: "ARS" as const,
    cartera_account_id: UUID,
  };

  it("exige canal", () => {
    expect(ManualChequeCreateSchema.safeParse(valid).success).toBe(false);
    expect(
      ManualChequeCreateSchema.safeParse({
        ...valid,
        channel_id: "jouve_internal",
      }).success,
    ).toBe(true);
  });
});

describe("DepositChequeSchema", () => {
  it("acepta payload válido", () => {
    expect(
      DepositChequeSchema.safeParse({
        check_id: UUID,
        account_id: UUID,
        channel_id: "dz_fiscal",
        event_date: "2026-05-01",
      }).success,
    ).toBe(true);
  });
});

describe("venta de cheques (roadmap 4.6)", () => {
  const sale = {
    check_ids: [UUID],
    account_id: UUID,
    channel_id: "jouve_fiscal",
    sale_date: "2026-11-03",
    buyer_name: "Banco Y",
    buyer_cuit: "30-11111111-8",
    interest: "1500,50",
    commission: "",
    idempotency_key: UUID,
  };

  it("knows the vendido status", () => {
    expect(isChequeStatus("vendido")).toBe(true);
    expect(CHECK_STATUS_LABEL.vendido).toBe("Vendido");
  });

  it("parses a sale, normalizing the CUIT", () => {
    const r = SellChequesSchema.safeParse({ ...sale, commission: "0" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.buyer_cuit).toBe("30111111118");
      expect(r.data.commission).toBe(0);
    }
  });

  it("needs checks, a buyer and a non-negative cost", () => {
    expect(
      SellChequesSchema.safeParse({ ...sale, check_ids: [] }).success,
    ).toBe(false);
    expect(
      SellChequesSchema.safeParse({ ...sale, buyer_name: " " }).success,
    ).toBe(false);
    expect(
      SellChequesSchema.safeParse({ ...sale, commission: "-1" }).success,
    ).toBe(false);
  });

  it("lets the rejection of a sold check name the repayment account", () => {
    const r = RejectChequeSchema.safeParse({
      check_id: UUID,
      channel_id: "jouve_fiscal",
      event_date: "2026-11-03",
      account_id: UUID,
    });
    expect(r.success).toBe(true);
  });
});
