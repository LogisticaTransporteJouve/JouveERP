import { describe, expect, it } from "vitest";

import type { AccountType } from "@/features/accounts/schema";

import { isCheckAccountType, isLiquidAccountType } from "./schema";

const LIQUID: AccountType[] = ["bank", "cash", "wallet", "investment"];
const CHECKS: AccountType[] = ["checks", "echeq"];

describe("isLiquidAccountType", () => {
  it("marca bank/cash/wallet/investment como líquidos", () => {
    for (const t of LIQUID) expect(isLiquidAccountType(t)).toBe(true);
  });

  it("no marca los tipos de cheque como líquidos", () => {
    for (const t of CHECKS) expect(isLiquidAccountType(t)).toBe(false);
  });
});

describe("isCheckAccountType", () => {
  it("marca checks/echeq como cheques en cartera", () => {
    for (const t of CHECKS) expect(isCheckAccountType(t)).toBe(true);
  });

  it("no marca los tipos líquidos como cheques", () => {
    for (const t of LIQUID) expect(isCheckAccountType(t)).toBe(false);
  });
});

describe("clasificación de cuentas", () => {
  it("ningún tipo es a la vez líquido y cheque (mutuamente excluyentes)", () => {
    for (const t of [...LIQUID, ...CHECKS]) {
      expect(isLiquidAccountType(t) && isCheckAccountType(t)).toBe(false);
    }
  });
});
