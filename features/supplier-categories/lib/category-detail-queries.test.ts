import { beforeEach, describe, expect, it, vi } from "vitest";

const priceEvolution = vi.fn();
const listPurchases = vi.fn();

vi.mock("@/features/suppliers/actions/purchases-report-actions", () => ({
  getSupplierPriceEvolutionAction: (input: unknown) => priceEvolution(input),
}));
vi.mock("../actions/supplier-categories-actions", () => ({
  listSupplierCategoryPurchasesAction: (input: unknown) => listPurchases(input),
}));

const { categoryPurchasesQuery, categorySpendQuery } =
  await import("./category-detail-queries");

const range = { from: "2026-01-01", to: "2026-11-05" };

beforeEach(() => {
  priceEvolution.mockReset();
  listPurchases.mockReset();
});

describe("categorySpendQuery", () => {
  it("reads the AI supplier RPC by category and by supplier, on the page scope", async () => {
    priceEvolution.mockImplementation(async (input: { groupBy: string }) => ({
      ok: true,
      data:
        input.groupBy === "category"
          ? [
              {
                period: "2026-01",
                dim_id: "c1",
                dim_label: "Combustible",
                documents: 2,
                net_ars: 80,
              },
            ]
          : [
              {
                period: "2026-01",
                dim_id: "s1",
                dim_label: "YPF",
                documents: 2,
                net_ars: 80,
              },
            ],
    }));
    const spend = await categorySpendQuery("c1", range, "internal").queryFn();
    expect(priceEvolution).toHaveBeenCalledTimes(2);
    for (const groupBy of ["category", "supplier"]) {
      expect(priceEvolution).toHaveBeenCalledWith({
        ...range,
        categoryId: "c1",
        scope: "internal",
        limit: 1000,
        groupBy,
      });
    }
    expect(spend.net).toBe(80);
    expect(spend.suppliers).toHaveLength(1);
  });

  it("fails the query when either read fails, never as zero", async () => {
    priceEvolution.mockImplementation(async (input: { groupBy: string }) =>
      input.groupBy === "supplier"
        ? { ok: false, error: "No se pudo calcular el reporte de proveedores." }
        : { ok: true, data: [] },
    );
    await expect(
      categorySpendQuery("c1", range, "fiscal").queryFn(),
    ).rejects.toThrow("No se pudo calcular el reporte de proveedores.");
  });
});

describe("categoryPurchasesQuery", () => {
  it.each([
    ["fiscal", true],
    ["internal", false],
    ["all", null],
  ] as const)("passes scope %s as isFiscal %s", async (scope, isFiscal) => {
    listPurchases.mockResolvedValue({
      ok: true,
      data: { purchases: [], hasMore: false },
    });
    await categoryPurchasesQuery("c1", range, scope).queryFn();
    expect(listPurchases).toHaveBeenCalledWith({
      categoryId: "c1",
      ...range,
      isFiscal,
      limit: 20,
    });
  });
});
