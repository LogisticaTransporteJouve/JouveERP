import { describe, expect, it } from "vitest";

import {
  ChequeCreateSchema,
  DepositChequeSchema,
  ManualChequeCreateSchema,
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
