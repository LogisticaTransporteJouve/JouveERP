// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ listAccounts: vi.fn(), mutate: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/providers/scope-provider", () => ({
  useScope: () => ({
    channels: [{ id: "jouve_fiscal", name: "Jouve", is_active: true }],
  }),
  useDefaultChannel: () => "jouve_fiscal",
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: h.listAccounts,
}));
vi.mock("../hooks/use-employee-account", () => ({
  useRecordAccountCash: () => ({ mutate: h.mutate, isPending: false }),
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
  h.mutate.mockReset();
});

async function open(kind: "advance" | "loan", button: RegExp) {
  h.listAccounts.mockResolvedValue({
    ok: true,
    data: [
      {
        id: "00000000-0000-4000-8000-0000000000a1",
        name: "Caja",
        type: "cash",
        currency: "ARS",
        is_active: true,
      },
    ],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EmployeeCashDialog
        kind={kind}
        employeeId="00000000-0000-4000-8000-0000000000e1"
        employeeName="Juan Pérez"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: button }));
  fireEvent.change(await screen.findByLabelText(/Importe/), {
    target: { value: "300000" },
  });
}

describe("EmployeeCashDialog: adelanto y préstamo", () => {
  it("an adelanto is discounted whole: its cuota is the amount", async () => {
    await open("advance", /Adelanto a empleado/);
    expect(screen.queryByLabelText("Cuota mensual")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(h.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "advance",
        amount: 300000,
        installment_amount: 300000,
      }),
      expect.anything(),
    );
  });

  it("a préstamo needs a cuota below the amount and shows the cuotas", async () => {
    await open("loan", /Préstamo a empleado/);
    const save = () => screen.getByRole("button", { name: "Registrar" });
    expect(save().hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Cuota mensual"), {
      target: { value: "300000" },
    });
    expect(save().hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Cuota mensual"), {
      target: { value: "100000" },
    });
    expect(screen.getByText(/3 cuotas de/)).toBeTruthy();
    fireEvent.click(save());
    expect(h.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "advance",
        installment_amount: 100000,
        description: "Préstamo a Juan Pérez",
      }),
      expect.anything(),
    );
  });
});
