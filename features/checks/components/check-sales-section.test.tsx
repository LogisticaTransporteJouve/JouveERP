// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckSaleDebt } from "../lib/check-sales";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// A native select stands in for Radix Select, which jsdom cannot open.
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
    <select
      aria-label="Cuenta"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
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
vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: () => null,
}));

const debts: CheckSaleDebt[] = [
  {
    id: "d-usd",
    check_id: "c1",
    check_number: "111",
    bank_name: "Banco",
    buyer_name: "Financiera",
    amount: 100,
    currency: "USD",
    rejected_on: "2026-10-01",
    paid_at: null,
  },
  {
    id: "d-ars",
    check_id: "c2",
    check_number: "222",
    bank_name: "Banco",
    buyer_name: "Financiera",
    amount: 1000,
    currency: "ARS",
    rejected_on: "2026-10-02",
    paid_at: null,
  },
];

vi.mock("@/features/accounts/hooks/use-accounts", () => ({
  useAccountsList: () => ({
    data: [
      { id: "acc-usd", name: "Banco USD", is_active: true, currency: "USD", type: "bank" },
      { id: "acc-ars", name: "Banco ARS", is_active: true, currency: "ARS", type: "bank" },
    ],
  }),
}));
vi.mock("../hooks/use-check-sales", () => ({
  useCheckSales: () => ({ isLoading: false, isError: false, data: [] }),
  useCheckSaleDebts: () => ({ isError: false, data: debts }),
  useCancelCheckSale: () => ({ isPending: false, mutate: vi.fn() }),
  usePayCheckSaleDebt: () => ({ isPending: false, mutate: vi.fn() }),
}));

const { CheckSalesSection } = await import("./check-sales-section");

afterEach(cleanup);

describe("CheckSalesSection · Pagar", () => {
  it("opens each debt with no account chosen", () => {
    render(<CheckSalesSection canWrite />);
    const [payUsd, payArs] = screen.getAllByRole("button", { name: "Pagar" });

    fireEvent.click(payUsd);
    fireEvent.change(screen.getByLabelText("Cuenta"), {
      target: { value: "acc-usd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));

    fireEvent.click(payArs);
    expect(screen.getByText("Pagar cheque 222")).toBeTruthy();
    const submit = screen
      .getAllByRole("button", { name: "Pagar" })
      .find((b) => b.closest("[role=dialog]"));
    expect(submit?.hasAttribute("disabled")).toBe(true);
  });
});
