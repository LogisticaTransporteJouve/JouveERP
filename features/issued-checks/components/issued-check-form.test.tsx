// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IssuedCheck } from "../schema";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/features/suppliers/components/supplier-picker", () => ({
  SupplierPicker: () => null,
}));
vi.mock("../hooks/use-issued-checks", () => ({
  useCreateIssuedCheck: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssuedCheck: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { IssuedCheckForm } = await import("./issued-check-form");

const check: IssuedCheck = {
  id: "ic1",
  kind: "fisico",
  check_number: "123",
  bank_name: "Banco",
  beneficiary_name: null,
  beneficiary_cuit: null,
  issue_date: "2026-11-01",
  due_date: "2026-11-30",
  amount: 1000,
  currency: "ARS",
  bank_account_id: "00000000-0000-4000-8000-000000000001",
  payment_order_id: null,
  channel_id: null,
  supplier_id: null,
  status: "emitted",
  cashed_at: null,
  rejected_at: null,
  cancelled_at: null,
  cancelled_by: null,
  notes: null,
  created_by: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

function renderForm(c: IssuedCheck) {
  render(<IssuedCheckForm mode="edit" check={c} accounts={[]} channels={[]} />);
  return screen.getByPlaceholderText("0,00");
}

afterEach(cleanup);

describe("IssuedCheckForm", () => {
  it("locks the money fields of a payment order's check", () => {
    const amount = renderForm({ ...check, payment_order_id: "op-1" });
    expect(amount.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(/se cambian editando la orden de pago/),
    ).toBeTruthy();
  });

  it("keeps them editable on a check of its own", () => {
    const amount = renderForm(check);
    expect(amount.hasAttribute("disabled")).toBe(false);
    expect(
      screen.queryByText(/se cambian editando la orden de pago/),
    ).toBeNull();
  });
});
