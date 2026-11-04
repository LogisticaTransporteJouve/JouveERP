// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ listAccounts: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/components/providers/scope-provider", () => ({
  useScope: () => ({ channels: [] }),
  useDefaultChannel: () => null,
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: h.listAccounts,
}));
vi.mock("../hooks/use-employee-account", () => ({
  useRecordAccountCash: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/use-employees", () => ({
  useEmployeesList: () => ({ data: [] }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { EmployeeCashDialog } = await import("./employee-cash-dialog");

afterEach(() => {
  cleanup();
  h.listAccounts.mockReset();
});

describe("EmployeeCashDialog with accounts:read denied", () => {
  it("says why inside the dialog instead of failing the page", async () => {
    h.listAccounts.mockResolvedValue({
      ok: false,
      error: "No tenés permiso para ver cuentas.",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <p>Página</p>
        <EmployeeCashDialog
          kind="advance"
          employeeId="e1"
          employeeName="Juan Pérez"
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Adelanto/ }));
    expect(
      await screen.findByText("No tenés permiso para ver cuentas."),
    ).toBeTruthy();
    expect(screen.getByText("Página")).toBeTruthy();
  });
});
