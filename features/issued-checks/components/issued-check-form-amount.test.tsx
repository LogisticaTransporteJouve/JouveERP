// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/features/accounts/schema";

import { IssuedCheckUpdateSchema, type IssuedCheck } from "../schema";

const update = vi.fn();

vi.mock("../hooks/use-issued-checks", () => ({
  useCreateIssuedCheck: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssuedCheck: () => ({ mutate: update, isPending: false }),
}));
vi.mock("@/features/suppliers/components/supplier-picker", () => ({
  SupplierPicker: () => null,
}));

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { IssuedCheckForm } = await import("./issued-check-form");

afterEach(() => {
  cleanup();
  update.mockReset();
});

const BANK: Account = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Banco Galicia",
  type: "bank",
  currency: "ARS",
  is_active: true,
  notes: null,
  opening_balance: 0,
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-10-01T00:00:00Z",
};

const CHECK: IssuedCheck = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "fisico",
  check_number: "12345678",
  bank_name: "Banco Galicia",
  beneficiary_name: null,
  beneficiary_cuit: null,
  issue_date: "2026-10-01",
  due_date: "2026-11-01",
  amount: 1234.56,
  currency: "ARS",
  bank_account_id: BANK.id,
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
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

function amountField(): HTMLInputElement {
  const el = screen.getByLabelText("Monto");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

/** What the server reads from the payload the form sent. */
async function savedAmount(): Promise<number | undefined> {
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  return IssuedCheckUpdateSchema.parse(update.mock.calls[0]?.[0]).amount;
}

function renderForm(amount: number) {
  render(
    <IssuedCheckForm
      mode="edit"
      check={{ ...CHECK, amount }}
      accounts={[BANK]}
      channels={[]}
    />,
  );
}

describe("IssuedCheckForm amount", () => {
  it("prefills 1234.56 as 1.234,56 and saves it unchanged", async () => {
    renderForm(1234.56);
    expect(amountField().value).toBe("1.234,56");
    expect(await savedAmount()).toBe(1234.56);
  });

  it("saves a typed 1.234,56 as 1234.56 and drops a typed dot in sight", async () => {
    renderForm(10);
    fireEvent.change(amountField(), { target: { value: "1234.56" } });
    expect(amountField().value).toBe("123.456");
    fireEvent.change(amountField(), { target: { value: "1.234,56" } });
    expect(await savedAmount()).toBe(1234.56);
  });
});
