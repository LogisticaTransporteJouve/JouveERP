// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoanInstallment } from "../schema";

// Clearing «Monto» is no amount, not a 0 cuota (w6-s2 F5).

const mutate = vi.fn();
const toastError = vi.fn();

vi.mock("../hooks/use-loans", () => ({
  useUpdateInstallment: () => ({ mutate, isPending: false }),
}));
vi.mock("sonner", () => ({
  toast: { error: (msg: string) => toastError(msg), success: vi.fn() },
}));

const { EditInstallmentDialog } = await import("./edit-installment-dialog");

const installment: LoanInstallment = {
  id: "00000000-0000-4000-8000-000000000001",
  loan_id: "00000000-0000-4000-8000-000000000002",
  number: 3,
  due_date: "2026-12-10",
  amount: 1500,
  status: "pendiente",
  paid_date: null,
  paid_amount: null,
  transaction_id: null,
  notes: null,
  split: null,
};

beforeEach(() => {
  mutate.mockClear();
  toastError.mockClear();
});
afterEach(cleanup);

function amountInput() {
  return screen.getByLabelText("Monto");
}

describe("EditInstallmentDialog", () => {
  it("refuses a blank amount instead of saving a 0 cuota", () => {
    render(
      <EditInstallmentDialog installment={installment} onClose={() => {}} />,
    );
    fireEvent.change(amountInput(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Monto requerido.");
  });

  it("saves the amount typed", () => {
    render(
      <EditInstallmentDialog installment={installment} onClose={() => {}} />,
    );
    fireEvent.change(amountInput(), { target: { value: "1800" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      id: installment.id,
      amount: 1800,
    });
  });
});
