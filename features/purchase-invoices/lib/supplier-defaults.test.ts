import { describe, expect, it } from "vitest";

import type { CostTagOptions } from "@/features/cost-centers/schema";

import { supplierCostDefaults } from "./supplier-defaults";

const OPTIONS: CostTagOptions = {
  expenseAccounts: [{ id: "acc-fuel", code: "5.1.1", name: "Combustible" }],
  costCenters: [{ id: "cc-jouve", code: "FLOTA_JOUVE", name: "Flota Jouve" }],
  inactiveCostCenters: [{ id: "cc-dz", code: "FLOTA_DZ", name: "Flota DZ" }],
};

describe("supplierCostDefaults", () => {
  it("takes the supplier's active account and center", () => {
    expect(
      supplierCostDefaults(
        {
          default_expense_account_id: "acc-fuel",
          default_cost_center_id: "cc-jouve",
        },
        OPTIONS,
      ),
    ).toEqual([
      { name: "account_id", id: "acc-fuel" },
      { name: "cost_center_id", id: "cc-jouve" },
    ]);
  });

  it("leaves a retired center (FLOTA_DZ) and an unlisted account empty", () => {
    expect(
      supplierCostDefaults(
        {
          default_expense_account_id: "acc-retired",
          default_cost_center_id: "cc-dz",
        },
        OPTIONS,
      ),
    ).toEqual([]);
  });

  it("sets nothing until the options are read", () => {
    expect(
      supplierCostDefaults(
        {
          default_expense_account_id: "acc-fuel",
          default_cost_center_id: "cc-jouve",
        },
        undefined,
      ),
    ).toEqual([]);
  });
});
