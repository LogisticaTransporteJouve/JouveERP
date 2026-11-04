// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/features/accounts/schema";

import { SellChequesSchema, type Cheque } from "../schema";

const sell = vi.fn();

const BANK: Account = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Banco",
  type: "bank",
  currency: "ARS",
  is_active: true,
  notes: null,
  opening_balance: 0,
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-10-01T00:00:00Z",
};

const CHECK: Cheque = {
  id: "00000000-0000-4000-8000-000000000001",
  amount: 100_000,
  bank_name: "Banco Galicia",
  cartera_account_id: "00000000-0000-4000-8000-000000000003",
  channel_id: "ch1",
  check_number: "123",
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  currency: "ARS",
  drawer_cuit: null,
  drawer_name: "Cliente SRL",
  due_date: "2026-12-01",
  issue_date: "2026-10-01",
  kind: "fisico",
  notes: null,
  source_client_id: null,
  source_kind: "manual",
  source_payment_line_id: null,
  source_receipt_id: null,
  status: "en_cartera",
  updated_at: "2026-10-01T00:00:00Z",
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/features/accounts/hooks/use-accounts", () => ({
  useAccountsList: () => ({ data: [BANK] }),
}));
vi.mock("../hooks/use-checks", () => ({
  useSellCheques: () => ({ mutate: sell, isPending: false }),
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

const { SellChequesDialog } = await import("./sell-checks-dialog");

afterEach(() => {
  cleanup();
  sell.mockReset();
});

function type(label: string, text: string): HTMLInputElement {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  fireEvent.change(el, { target: { value: text } });
  return el;
}

describe("SellChequesDialog interest and commission", () => {
  it("saves a typed 1.234,56 as 1234.56, not 1.234", async () => {
    render(
      <SellChequesDialog
        checks={[CHECK]}
        channels={[{ id: "ch1", name: "Jouve fiscal", is_active: true }]}
        open
        onOpenChange={vi.fn()}
        onSold={vi.fn()}
      />,
    );
    type("Comprador", "Financiera SA");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: BANK.id },
    });
    expect(type("Intereses", "1234.56").value).toBe("123.456");
    type("Intereses", "1.234,56");
    type("Comisiones y gastos", "1.500");
    fireEvent.click(screen.getByRole("button", { name: "Vender" }));
    await vi.waitFor(() => expect(sell).toHaveBeenCalledTimes(1));
    const saved = SellChequesSchema.parse(sell.mock.calls[0]?.[0]);
    expect([saved.interest, saved.commission]).toEqual([1234.56, 1500]);
  });
});
