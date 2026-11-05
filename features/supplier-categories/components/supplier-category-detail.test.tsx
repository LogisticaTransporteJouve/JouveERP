// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryState = {
  data?: unknown;
  isError: boolean;
  refetch: () => void;
};

const spendRefetch = vi.fn();
const purchasesRefetch = vi.fn();
let spend: QueryState;
let purchases: QueryState;
const enabledSeen: boolean[] = [];

vi.mock("@/components/providers/scope-provider", () => ({
  usePageScope: () => "fiscal",
}));
vi.mock("@/hooks/use-list-params", () => ({
  useListParams: ({ initial }: { initial: unknown }) => ({
    params: initial,
    update: vi.fn(),
  }),
}));
vi.mock("@/components/period-filter", () => ({
  PeriodFilter: () => <button type="button">Este año</button>,
}));
vi.mock("../hooks/use-supplier-category-detail", () => ({
  useSupplierCategorySpend: (...args: unknown[]) => {
    enabledSeen.push(args[3] === true);
    return spend;
  },
  useSupplierCategoryPurchases: () => purchases,
}));

const { SupplierCategoryDetail } = await import("./supplier-category-detail");

const period = { preset: "this_year" as const, from: null, to: null };

const renderDetail = (canReadPurchases = true) =>
  render(
    <SupplierCategoryDetail
      categoryId="c1"
      initialPeriod={period}
      canReadPurchases={canReadPurchases}
    />,
  );

beforeEach(() => {
  enabledSeen.length = 0;
  spendRefetch.mockReset();
  purchasesRefetch.mockReset();
  spend = {
    isError: false,
    refetch: spendRefetch,
    data: {
      net: 1234.5,
      documents: 3,
      months: [{ period: "2026-10", documents: 3, net: 1234.5 }],
      suppliers: [
        { supplierId: "s1", legalName: "YPF S.A.", documents: 3, net: 1234.5 },
      ],
      suppliersPartial: false,
    },
  };
  purchases = {
    isError: false,
    refetch: purchasesRefetch,
    data: {
      hasMore: false,
      purchases: [
        {
          id: "p1",
          kind: "nc",
          letter: "A",
          punto_venta: 3,
          numero: 15,
          fecha: "2026-10-01",
          imp_total: 121,
          moneda: "PES",
          supplier_id: "s1",
          supplier_legal_name: "YPF S.A.",
          is_fiscal: true,
        },
      ],
    },
  };
});

afterEach(cleanup);

describe("SupplierCategoryDetail", () => {
  it("shows no amount and reads nothing without purchase_invoices:read", () => {
    renderDetail(false);
    expect(screen.getByText(/No tenés permiso para ver compras/)).toBeTruthy();
    expect(screen.queryByText("Total gastado")).toBeNull();
    expect(enabledSeen).toEqual([false]);
  });

  it("shows the totals and links suppliers and purchases", () => {
    renderDetail();
    expect(screen.getByText("Total gastado")).toBeTruthy();
    expect(screen.getAllByText("$ 1.234,50").length).toBeGreaterThan(0);
    const supplierLinks = screen
      .getAllByRole("link", { name: "YPF S.A." })
      .map((a) => a.getAttribute("href"));
    expect(supplierLinks).toContain("/suppliers/s1");
    expect(
      screen
        .getByRole("link", { name: /NC00003-00000015/ })
        .getAttribute("href"),
    ).toBe("/purchases/p1");
  });

  it("shows a failed spend read with «Reintentar», never as $0", () => {
    spend = { isError: true, refetch: spendRefetch, data: undefined };
    renderDetail();
    expect(
      screen.getByText("No se pudieron leer los gastos de la categoría."),
    ).toBeTruthy();
    expect(screen.queryByText("$ 0,00")).toBeNull();
    expect(screen.queryByText("Total gastado")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(spendRefetch).toHaveBeenCalled();
  });

  it("shows a failed purchases read with «Reintentar», not as empty", () => {
    purchases = { isError: true, refetch: purchasesRefetch, data: undefined };
    renderDetail();
    expect(screen.queryByText("Sin compras en el período.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(purchasesRefetch).toHaveBeenCalled();
  });
});
