// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Productos: a failed client read is said under the «Cliente» select, not
// left as an empty list.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-products", () => ({
  useCreateProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { ProductDialog } = await import("./product-dialog");

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

type Options = { id: string; legal_name: string }[] | null;

function renderDialog(clientOptions: Options) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProductDialog
        mode="create"
        clientOptions={clientOptions}
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("product dialog", () => {
  it("says the clients could not be read and retries the page", () => {
    renderDialog(null);
    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los clientes.",
    );
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows no error when the clients were read, even none", () => {
    renderDialog([]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
