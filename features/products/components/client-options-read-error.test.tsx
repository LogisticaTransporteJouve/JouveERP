// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Productos and Tarifas de depósito: a failed client read is said under the
// «Cliente» select, not left as an empty list.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-products", () => ({
  useCreateProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/storage-tariffs/hooks/use-storage-tariffs", () => ({
  useCreateStorageTariff: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateStorageTariff: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/warehouses/actions/storage-areas-actions", () => ({
  listStorageAreasAction: async () => ({ ok: true, data: [] }),
}));

const { ProductDialog } = await import("./product-dialog");
const { StorageTariffDialog } =
  await import("@/features/storage-tariffs/components/storage-tariff-dialog");

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

type Options = { id: string; legal_name: string }[] | null;

function renderBoth(which: "product" | "tariff", clientOptions: Options) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      {which === "product" ? (
        <ProductDialog
          mode="create"
          clientOptions={clientOptions}
          open
          onOpenChange={() => {}}
        />
      ) : (
        <StorageTariffDialog
          mode="create"
          clientOptions={clientOptions}
          open
          onOpenChange={() => {}}
        />
      )}
    </QueryClientProvider>,
  );
}

describe.each(["product", "tariff"] as const)("%s dialog", (which) => {
  it("says the clients could not be read and retries the page", () => {
    renderBoth(which, null);
    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los clientes.",
    );
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows no error when the clients were read, even none", () => {
    renderBoth(which, []);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
