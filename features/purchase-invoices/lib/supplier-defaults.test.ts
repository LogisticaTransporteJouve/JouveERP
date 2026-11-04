import { describe, expect, it } from "vitest";

import type { CostTagOptions } from "@/features/cost-centers/schema";

import {
  purchaseCostDefaults,
  suggestedCostDefaults,
  supplierCostDefaults,
  supplierCostWrites,
} from "./supplier-defaults";

describe("supplierCostWrites", () => {
  const A = [
    { name: "account_id", id: "acc-fuel" },
    { name: "cost_center_id", id: "cc-jouve" },
  ] as const;
  const fields =
    (values: Record<string, string>, dirty: string[] = []) =>
    (name: "account_id" | "cost_center_id") => ({
      value: values[name] ?? "",
      dirty: dirty.includes(name),
    });

  it("clears what the previous supplier prefilled when the new one has no default or a retired one", () => {
    const next = supplierCostDefaults(
      { default_expense_account_id: null, default_cost_center_id: "cc-dz" },
      OPTIONS,
    );
    expect(
      supplierCostWrites(
        A,
        next,
        fields({ account_id: "acc-fuel", cost_center_id: "cc-jouve" }),
      ),
    ).toEqual([
      { name: "account_id", id: "" },
      { name: "cost_center_id", id: "" },
    ]);
  });

  it("keeps what the user picked and what no supplier wrote", () => {
    expect(
      supplierCostWrites(
        A,
        [],
        fields({ account_id: "acc-ai", cost_center_id: "cc-jouve" }, [
          "cost_center_id",
        ]),
      ),
    ).toEqual([]);
  });

  it("writes the new supplier's defaults over the previous ones", () => {
    expect(
      supplierCostWrites(
        A,
        [{ name: "cost_center_id", id: "cc-other" }],
        fields({ account_id: "acc-fuel", cost_center_id: "cc-jouve" }),
      ),
    ).toEqual([
      { name: "account_id", id: "" },
      { name: "cost_center_id", id: "cc-other" },
    ]);
  });
});

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

describe("purchaseCostDefaults", () => {
  const supplier = supplierCostDefaults(
    { default_expense_account_id: "acc-fuel", default_cost_center_id: null },
    OPTIONS,
  );
  const suggested = suggestedCostDefaults({
    account: { id: "acc-ai" },
    cost_center_id: "cc-ai",
  });
  const asFactura = purchaseCostDefaults("factura", suggested, supplier);
  const untouched = (name: "account_id" | "cost_center_id") => ({
    value: name === "account_id" ? "acc-fuel" : "cc-ai",
    dirty: false,
  });

  it("takes the supplier's defaults over the scan's suggestion, field by field", () => {
    expect(asFactura).toEqual([
      { name: "account_id", id: "acc-fuel" },
      { name: "cost_center_id", id: "cc-ai" },
    ]);
  });

  it("clears what the supplier or the scan prefilled when the type becomes NC or ND", () => {
    for (const kind of ["nc", "nd"] as const) {
      expect(
        supplierCostWrites(
          asFactura,
          purchaseCostDefaults(kind, suggested, supplier),
          untouched,
        ),
      ).toEqual([
        { name: "account_id", id: "" },
        { name: "cost_center_id", id: "" },
      ]);
    }
  });

  it("clears a scanned suggestion with no supplier, and puts it back as factura", () => {
    const scanOnly = purchaseCostDefaults("factura", suggested, []);
    expect(
      supplierCostWrites(
        scanOnly,
        purchaseCostDefaults("nc", suggested, []),
        (name) => ({
          value: name === "account_id" ? "acc-ai" : "cc-ai",
          dirty: false,
        }),
      ),
    ).toEqual([
      { name: "account_id", id: "" },
      { name: "cost_center_id", id: "" },
    ]);
    expect(
      supplierCostWrites([], scanOnly, () => ({ value: "", dirty: false })),
    ).toEqual(scanOnly);
  });

  it("keeps an account the user picked on the NC", () => {
    expect(
      supplierCostWrites(
        asFactura,
        purchaseCostDefaults("nc", suggested, supplier),
        (name) =>
          name === "account_id"
            ? { value: "acc-other", dirty: true }
            : { value: "cc-ai", dirty: false },
      ),
    ).toEqual([{ name: "cost_center_id", id: "" }]);
  });
});

describe("suggestedCostDefaults", () => {
  it("is empty without a draft or with a draft that suggests nothing", () => {
    expect(suggestedCostDefaults(null)).toEqual([]);
    expect(
      suggestedCostDefaults({ account: null, cost_center_id: null }),
    ).toEqual([]);
  });
});
