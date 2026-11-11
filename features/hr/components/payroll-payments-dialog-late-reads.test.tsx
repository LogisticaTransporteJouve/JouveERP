// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  payments: {
    isLoading: false,
    isError: false,
    data: [] as unknown[] | undefined,
    refetch: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: h.listAccounts,
}));
vi.mock("../hooks/use-payroll-payments", () => ({
  usePayrollPayments: () => h.payments,
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
  h.payments = { isLoading: false, isError: false, data: [], refetch: vi.fn() };
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
        paid={0}
        saldo={100_000}
        year={2026}
        month={10}
        disabled={false}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTitle(/Pagado/));
}

const galicia = {
  id: "a1",
  name: "Banco Galicia",
  type: "bank",
  currency: "ARS",
  is_active: true,
};

describe("PayrollPaymentsDialog with late reads", () => {
  it("selects the first account once a retried accounts read arrives", async () => {
    h.listAccounts
      .mockResolvedValueOnce({ ok: false, error: "timeout" })
      .mockResolvedValue({ ok: true, data: [galicia] });
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("Cuenta")).toBeTruthy();
    const [accountSelect] = screen.getAllByRole("combobox");
    expect(accountSelect?.textContent).toContain("Banco Galicia");
  });

  it("says the payments could not be read instead of «Sin pagos todavía.»", async () => {
    h.listAccounts.mockResolvedValue({ ok: true, data: [galicia] });
    h.payments = {
      isLoading: false,
      isError: true,
      data: undefined,
      refetch: vi.fn(),
    };
    openDialog();
    expect(
      await screen.findByText("No se pudieron cargar los pagos."),
    ).toBeTruthy();
    expect(screen.queryByText("Sin pagos todavía.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.payments.refetch).toHaveBeenCalled();
  });

  it("lists a split payment once, with its books and management pieces", async () => {
    h.listAccounts.mockResolvedValue({ ok: true, data: [galicia] });
    const piece = {
      account_id: "a1",
      channel_id: "jouve_fiscal",
      method: "transferencia",
      paid_at: "2026-10-31",
      notes: null,
    };
    h.payments = {
      isLoading: false,
      isError: false,
      data: [
        {
          ...piece,
          id: "p1",
          split_parent_id: null,
          is_fiscal: true,
          reconciled: true,
          amount: 60_000,
        },
        {
          ...piece,
          id: "p2",
          channel_id: "jouve_internal",
          split_parent_id: "p1",
          is_fiscal: false,
          reconciled: true,
          amount: 40_000,
        },
      ],
      refetch: vi.fn(),
    };
    openDialog();
    expect(
      await screen.findByText(/Libros .*60\.000.* · Gestión .*40\.000/),
    ).toBeTruthy();
    expect(
      await screen.findAllByRole("button", { name: "Editar pago" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Editar pago" }));
    expect(
      await screen.findByText("Conciliado: desconciliá para cambiar el monto"),
    ).toBeTruthy();
  });
});
