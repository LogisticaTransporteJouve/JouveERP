// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ listAccounts: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/providers/scope-provider", () => ({
  useScope: () => ({
    channels: [
      { id: "jouve_fiscal", name: "Jouve", is_fiscal: true, is_active: true },
    ],
  }),
  useDefaultChannel: () => "jouve_fiscal",
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: h.listAccounts,
}));
vi.mock("../hooks/use-payroll-payments", () => ({
  usePayrollPayments: () => ({
    isLoading: false,
    data: [
      {
        id: "p1",
        account_id: "a1",
        channel_id: "jouve_fiscal",
        amount: 50_000,
        method: "transferencia",
        paid_at: "2026-10-31",
        notes: null,
      },
    ],
  }),
  useCreatePayrollPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePayrollPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePayrollPayment: () => ({ mutate: vi.fn(), isPending: false }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { PayrollPaymentsDialog } = await import("./payroll-payments-dialog");

afterEach(() => {
  cleanup();
  h.listAccounts.mockReset();
});

function openDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PayrollPaymentsDialog
        entryId="e1"
        employeeName="Juan Pérez"
        total={100_000}
        paid={50_000}
        saldo={50_000}
        year={2026}
        month={10}
        disabled={false}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTitle(/Pagado/));
}

describe("PayrollPaymentsDialog without accounts", () => {
  it("keeps the payment history and its delete, and says why it cannot pay", async () => {
    h.listAccounts.mockResolvedValue({
      ok: false,
      error: "No tenés permiso para ver cuentas.",
    });
    openDialog();
    expect(
      await screen.findByText("No tenés permiso para ver cuentas."),
    ).toBeTruthy();
    expect(screen.getByText(/Transferencia/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Borrar pago" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar pago" })).toBeNull();
    expect(screen.queryByText("Cuenta")).toBeNull();
  });

  it("offers the form and edit once the accounts are read", async () => {
    h.listAccounts.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "a1",
          name: "Banco Galicia",
          type: "bank",
          currency: "ARS",
          is_active: true,
        },
      ],
    });
    openDialog();
    expect(await screen.findAllByText(/Banco Galicia/)).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Editar pago" })).toBeTruthy();
    expect(screen.getByText("Cuenta")).toBeTruthy();
  });
});
