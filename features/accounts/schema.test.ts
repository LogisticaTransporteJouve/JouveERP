import { describe, expect, it } from "vitest";

import {
  AccountCreateSchema,
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
