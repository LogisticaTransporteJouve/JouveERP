// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// A native select stands in for Radix Select, which jsdom cannot open.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectSeparator: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/providers/scope-provider", () => ({
  usePageIsFiscal: () => true,
  useScope: () => ({ channels: [] }),
}));

// The identity block is out of scope here: one field stands for the rest.
vi.mock("@/components/counterparty-identity-fields", async (orig) => ({
  ...(await orig<typeof import("@/components/counterparty-identity-fields")>()),
  CounterpartyIdentityFields: () => {
    const { register } = useFormContext();
    return <input aria-label="Razón social" {...register("legal_name")} />;
  },
}));

vi.mock("@/features/cost-centers/components/cost-tag-select", () => ({
  CostTagSelect: () => null,
}));

const createSupplier = vi.fn();
vi.mock("../hooks/use-suppliers", () => ({
  useCreateSupplier: () => ({ mutate: createSupplier, isPending: false }),
  useUpdateSupplier: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../actions/suppliers-actions", () => ({
  findSupplierByCuitAction: vi.fn(),
}));

type Category = { id: string; name: string };
let categories: Category[] = [];
let canCreate = true;
const createCategory = vi.fn();
vi.mock(
  "@/features/supplier-categories/actions/supplier-categories-actions",
  () => ({
    listSupplierCategoriesAction: async () => ({
      ok: true,
      data: categories,
    }),
    canCreateSupplierCategoryAction: async () => ({
      ok: true,
      data: canCreate,
    }),
    createSupplierCategoryAction: (input: unknown) => createCategory(input),
  }),
);

const { SupplierForm } = await import("./supplier-form");

function renderForm() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierForm mode="create" />
    </QueryClientProvider>,
  );
}

async function categorySelect(): Promise<HTMLSelectElement> {
  const option = await screen.findByRole("option", {
    name: "Sin categoría",
    hidden: true,
  });
  const select = option.closest("select");
  if (!select) throw new Error("no category select");
  return select;
}

beforeEach(() => {
  categories = [{ id: "cat-fuel", name: "Combustible" }];
  canCreate = true;
  createCategory.mockReset();
  createSupplier.mockReset();
});
afterEach(cleanup);

describe("SupplierForm · Nueva categoría", () => {
  it("creates a category from the select, selects it and keeps the form", async () => {
    createCategory.mockImplementation(async (input: { name: string }) => {
      categories = [...categories, { id: "cat-new", name: input.name }];
      return { ok: true, data: { id: "cat-new" } };
    });
    renderForm();

    fireEvent.change(screen.getByLabelText("Razón social"), {
      target: { value: "Transportes del Sur" },
    });
    fireEvent.change(screen.getByLabelText("Plazo de pago (días)"), {
      target: { value: "30" },
    });

    const select = await categorySelect();
    await within(select).findByRole("option", { name: "Nueva categoría" });
    fireEvent.change(select, { target: { value: "__new" } });

    const dialog = await screen.findByRole("dialog", {
      name: "Nueva categoría",
    });
    fireEvent.change(within(dialog).getByLabelText("Nombre"), {
      target: { value: "  Peajes " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Nueva categoría" }),
      ).toBeNull(),
    );
    expect(createCategory).toHaveBeenCalledWith({ name: "Peajes" });
    const after = await categorySelect();
    expect(after.value).toBe("cat-new");
    expect(within(after).getByRole("option", { name: "Peajes" })).toBeTruthy();
    expect(
      (screen.getByLabelText("Razón social") as HTMLInputElement).value,
    ).toBe("Transportes del Sur");
    expect(
      (screen.getByLabelText("Plazo de pago (días)") as HTMLInputElement).value,
    ).toBe("30");
    expect(
      screen.getByText("Vence 30 días después de la fecha de la factura."),
    ).toBeTruthy();
    // The nested dialog's submit does not submit the supplier.
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it("shows the duplicate error and keeps the dialog open", async () => {
    createCategory.mockResolvedValue({
      ok: false,
      error: 'Ya existe la categoría "Combustible".',
    });
    renderForm();
    const select = await categorySelect();
    await within(select).findByRole("option", { name: "Nueva categoría" });
    fireEvent.change(select, { target: { value: "__new" } });

    const dialog = await screen.findByRole("dialog", {
      name: "Nueva categoría",
    });
    fireEvent.change(within(dialog).getByLabelText("Nombre"), {
      target: { value: "combustible" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));

    expect(
      await within(dialog).findByText('Ya existe la categoría "Combustible".'),
    ).toBeTruthy();
    expect((await categorySelect()).value).toBe("__none");
  });

  it("hides the item without suppliers:write", async () => {
    canCreate = false;
    renderForm();
    const select = await categorySelect();
    await within(select).findByRole("option", { name: "Combustible" });
    expect(
      within(select).queryByRole("option", { name: "Nueva categoría" }),
    ).toBeNull();
  });

  it("labels the purchase defaults without Spanglish", async () => {
    renderForm();
    expect(
      screen.getByText(
        "Al cargar una compra de este proveedor, completar con:",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Canal")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ninguno" })).toBeTruthy();
    expect(screen.queryByText(/default/i)).toBeNull();
    expect(
      screen.getByText("Vence N días después de la fecha de la factura."),
    ).toBeTruthy();
  });
});
