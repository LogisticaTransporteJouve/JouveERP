import { describe, expect, it } from "vitest";

import {
  AccountCreateSchema,
  AccountOpeningBalanceInputSchema,
  AccountToggleActiveSchema,
  isCheckAccount,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("isCheckAccount", () => {
  it("true para checks y echeq", () => {
    expect(isCheckAccount("checks")).toBe(true);
    expect(isCheckAccount("echeq")).toBe(true);
  });
  it("false para los demás", () => {
    expect(isCheckAccount("bank")).toBe(false);
    expect(isCheckAccount("cash")).toBe(false);
    expect(isCheckAccount(undefined)).toBe(false);
  });
});

describe("AccountCreateSchema", () => {
  it("acepta payload válido", () => {
    expect(
      AccountCreateSchema.safeParse({
        name: "Caja Principal",
        type: "cash",
        currency: "ARS",
        opening_balance: 0,
      }).success,
    ).toBe(true);
  });

  it("opening_balance acepta string AR-format", () => {
    const res = AccountCreateSchema.safeParse({
      name: "Caja AR",
      type: "cash",
      currency: "ARS",
      opening_balance: "1.234,56",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.opening_balance).toBe(1234.56);
  });

  it("rechaza type desconocido", () => {
    expect(
      AccountCreateSchema.safeParse({
        name: "Caja",
        type: "foo",
        currency: "ARS",
        opening_balance: 0,
      }).success,
    ).toBe(false);
  });
});

describe("AccountToggleActiveSchema", () => {
  it("acepta payload", () => {
    expect(
      AccountToggleActiveSchema.safeParse({ id: UUID, is_active: false })
        .success,
    ).toBe(true);
  });
});

describe("AccountOpeningBalanceInputSchema", () => {
  const base = {
    account_id: UUID,
    adjustment_date: "2026-10-31",
    target_balance: 1500,
    channel_id: "jouve_fiscal",
  };

  it("acepta un ajuste con canal", () => {
    expect(AccountOpeningBalanceInputSchema.safeParse(base).success).toBe(true);
  });

  it("exige elegir canal (sin default)", () => {
    const result = AccountOpeningBalanceInputSchema.safeParse({
      ...base,
      channel_id: "",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Elegí un canal para imputar el ajuste.",
    );
  });

  it("rechaza una fecha mal formada", () => {
    expect(
      AccountOpeningBalanceInputSchema.safeParse({
        ...base,
        adjustment_date: "31/10/2026",
      }).success,
    ).toBe(false);
  });
});
