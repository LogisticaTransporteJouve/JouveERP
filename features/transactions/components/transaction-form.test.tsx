// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/features/accounts/schema";

import { TransactionCreateSchema, TransferCreateSchema } from "../schema";

const createTx = vi.fn();
const createTransfer = vi.fn();

const account = (id: string, name: string): Account => ({
  id,
  name,
  type: "bank",
  currency: "ARS",
  is_active: true,
  notes: null,
  opening_balance: 0,
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-10-01T00:00:00Z",
});
const BANK = account("00000000-0000-4000-8000-000000000002", "Banco");
const CASH = account("00000000-0000-4000-8000-000000000003", "Caja");

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/components/providers/scope-provider", () => ({
  useDefaultChannel: () => "ch1",
}));
vi.mock("@/features/accounts/hooks/use-accounts", () => ({
  useAccountsList: () => ({ data: [BANK, CASH] }),
}));
vi.mock("@/features/cost-centers/components/cost-tag-select", () => ({
  CostTagSelect: () => null,
}));
vi.mock("@/features/payment-orders/components/pay-dialog", () => ({
  PayDialog: () => null,
}));
vi.mock("@/features/receipts/components/collect-dialog", () => ({
  CollectDialog: () => null,
}));
vi.mock("../hooks/use-transactions", () => ({
  useCreateTransaction: () => ({ mutate: createTx, isPending: false }),
  useCreateTransfer: () => ({ mutate: createTransfer, isPending: false }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const { TransactionForm } = await import("./transaction-form");

afterEach(() => {
  cleanup();
  createTx.mockReset();
  createTransfer.mockReset();
});

/** The account selects, in render order. */
function accountSelects(): HTMLSelectElement[] {
  return screen
    .getAllByRole("combobox")
    .filter(
      (el): el is HTMLSelectElement =>
        el instanceof HTMLSelectElement && el.textContent?.includes("Banco"),
    );
}

function typeAmount(text: string): HTMLInputElement {
  const el = screen.getByLabelText("Monto");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  fireEvent.change(el, { target: { value: text } });
  return el;
}

describe("TransactionForm amount", () => {
  it("saves a typed 1.234,56 as 1234.56 and drops a typed dot in sight", async () => {
    render(<TransactionForm channels={[{ id: "ch1", name: "Fiscal" }]} />);
    const [accountSelect] = accountSelects();
    fireEvent.change(accountSelect!, { target: { value: BANK.id } });
    expect(typeAmount("1234.56").value).toBe("123.456");
    typeAmount("1.234,56");
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await vi.waitFor(() => expect(createTx).toHaveBeenCalledTimes(1));
    expect(TransactionCreateSchema.parse(createTx.mock.calls[0]?.[0])).toEqual(
      expect.objectContaining({ amount: 1234.56 }),
    );
  });

  it("saves a transfer of 1.234,56 as 1234.56", async () => {
    render(<TransactionForm channels={[{ id: "ch1", name: "Fiscal" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Transferencia" }));
    const [from, to] = accountSelects();
    fireEvent.change(from!, { target: { value: BANK.id } });
    fireEvent.change(to!, { target: { value: CASH.id } });
    typeAmount("1.234,56");
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await vi.waitFor(() => expect(createTransfer).toHaveBeenCalledTimes(1));
    expect(
      TransferCreateSchema.parse(createTransfer.mock.calls[0]?.[0]).amount,
    ).toBe(1234.56);
  });
});
