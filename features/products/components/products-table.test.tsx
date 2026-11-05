// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const product = {
  id: "p1",
  name: "Yerba",
  client: { legal_name: "Acme" },
  sku: null,
  unit: null,
  is_active: true,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-products", () => ({
  useProducts: () => ({ data: [product] }),
  useDeleteProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useSetProductActive: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./product-dialog", () => ({ ProductDialog: () => null }));

const { ProductsTable } = await import("./products-table");

afterEach(cleanup);

describe("ProductsTable: write controls follow products:write", () => {
  it.each([
    ["admin", resolveAccess(["admin"]), true],
    ["warehouse", resolveAccess(["warehouse"]), false],
    [
      "admin with products:write denied",
      resolveAccess(["admin"], ["products:write"]),
      false,
    ],
  ])(
    "%s gets Nuevo producto, the row menu and Activo: %s",
    (_, access, can) => {
      render(<ProductsTable actorAccess={access} clientOptions={[]} />);
      expect(screen.getByText("Yerba")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Nuevo producto/ }) !== null,
      ).toBe(can);
      expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
        can,
      );
      const toggle = screen.getByRole("switch", { name: "Activo" });
      expect(toggle.hasAttribute("disabled")).toBe(!can);
    },
  );
});
