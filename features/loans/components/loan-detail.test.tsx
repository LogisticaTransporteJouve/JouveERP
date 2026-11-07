// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoanDetail as Loan } from "../schema";

const loan: Loan = {
  id: "l1",
  kind: "prestamo",
  description: "Préstamo banco",
  lender: "Banco",
  principal: 1000,
  currency: "ARS",
  channel_id: "jouve_fiscal",
  channel_name: "Fiscal",
  installments_count: 1,
  first_due_date: "2026-12-01",
  status: "active",
  notes: null,
  created_at: "2026-11-01T00:00:00Z",
  disbursement_transaction_id: null,
  loan_number: null,
  account_id: null,
  account_name: null,
  start_date: null,
  original_amount: null,
  tna: null,
  tea: null,
  cft: null,
  paid_count: 0,
  interest_paid: 0,
  next_due_amount: 1000,
  paid_total: 0,
  capital_outstanding: 1000,
  pending_total: 1000,
  pending_count: 1,
  next_due_date: "2026-12-01",
  bank_payments: [],
  opening_booked: false,
  book_from: "2026-01-01",
  installments: [
    {
      id: "i1",
      loan_id: "l1",
      number: 1,
      due_date: "2026-12-01",
      amount: 1000,
      status: "pendiente",
      paid_date: null,
      paid_amount: null,
      transaction_id: null,
      notes: null,
      split: null,
      paid_outside: false,
    },
  ],
};

const h = vi.hoisted(() => ({ listAccounts: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: h.listAccounts,
}));
vi.mock("../hooks/use-loans", () => ({ useLoan: () => ({ data: loan }) }));
vi.mock("./loan-bank-payments", () => ({ LoanBankPayments: () => null }));
vi.mock("./pay-installment-dialog", () => ({
  PayInstallmentDialog: () => null,
}));
vi.mock("./edit-installment-dialog", () => ({
  EditInstallmentDialog: () => null,
}));
vi.mock("./loan-movement-dialogs", () => ({
  AdoptInstallmentPaymentDialog: () => null,
  RecordDisbursementDialog: () => null,
}));

const { LoanDetail } = await import("./loan-detail");

afterEach(() => {
  cleanup();
  h.listAccounts.mockReset();
});

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LoanDetail loanId="l1" canWrite canMoveCash />
    </QueryClientProvider>,
  );
}

describe("LoanDetail accounts", () => {
  it("shows a failed accounts read with «Reintentar» and hides «Pagar» and «Registrar desembolso»", async () => {
    h.listAccounts.mockResolvedValue({
      ok: false,
      error: "No se pudieron cargar las cuentas.",
    });
    renderDetail();
    expect(
      await screen.findByText("No se pudieron cargar las cuentas."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pagar" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Registrar desembolso" }),
    ).toBeNull();

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
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByRole("button", { name: "Pagar" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Registrar desembolso" }),
    ).toBeTruthy();
  });
});
