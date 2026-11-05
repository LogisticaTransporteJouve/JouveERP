// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const category = {
  id: "cat1",
  name: "Combustible",
  is_active: true,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("../hooks/use-supplier-categories", () => ({
  useSupplierCategories: () => ({ data: [category] }),
  useDeleteSupplierCategory: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./supplier-category-dialog", () => ({
  SupplierCategoryDialog: () => null,
}));

const { SupplierCategoriesTable } = await import("./supplier-categories-table");

afterEach(cleanup);

describe("SupplierCategoriesTable: write controls follow suppliers:write", () => {
  it.each([
    ["finance", resolveAccess(["finance"]), true],
    ["operations", resolveAccess(["operations"]), false],
    ["fiscal_reader", resolveAccess(["fiscal_reader"]), false],
    [
      "finance with suppliers:write denied",
      resolveAccess(["finance"], ["suppliers:write"]),
      false,
    ],
  ])("%s sees Nueva categoría and the row menu: %s", (_, access, visible) => {
    render(<SupplierCategoriesTable actorAccess={access} />);
    expect(screen.getByText("Combustible")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Nueva categoría/ }) !== null,
    ).toBe(visible);
    expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
      visible,
    );
  });
});

describe("SupplierCategoriesTable: names open the category page", () => {
  it("links each name to /suppliers/categories/[id]", () => {
    render(
      <SupplierCategoriesTable actorAccess={resolveAccess(["operations"])} />,
    );
    expect(
      screen.getByRole("link", { name: "Combustible" }).getAttribute("href"),
    ).toBe("/suppliers/categories/cat1");
  });
});
