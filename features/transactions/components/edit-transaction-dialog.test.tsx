// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TransactionListItem } from "../actions/transactions-actions";
import { TransactionUpdateSchema } from "../schema";

const update = vi.fn();

vi.mock("../hooks/use-transactions", () => ({
  useUpdateTransaction: () => ({ mutate: update, isPending: false }),
}));
vi.mock("@/features/cost-centers/components/cost-tag-select", () => ({
  CostTagSelect: () => null,
}));

const { EditTransactionDialog } = await import("./edit-transaction-dialog");

afterEach(() => {
  cleanup();
  update.mockReset();
});

const TX: TransactionListItem = {
  id: "00000000-0000-4000-8000-000000000001",
  account_id: "00000000-0000-4000-8000-000000000002",
  channel_id: "00000000-0000-4000-8000-000000000003",
  kind: "income",
  amount: 1234.56,
  currency: "ARS",
  transaction_date: "2026-10-01",
  accrual_month: "2026-10-01",
  description: "Cobro",
  invoice_id: null,
  check_sale_id: null,
  counterparty_client_id: null,
  counterparty_supplier_id: null,
  manual_check_id: null,
  transfer_pair_id: null,
  created_by: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  receipt_id: null,
  payment_order_id: null,
  rejected_check_id: null,
  issued_check_id: null,
  is_payroll: false,
  cost_center_id: null,
  expense_account_id: null,
  channel_name: "Jouve fiscal",
  channel_is_fiscal: true,
  account_name: "Banco",
  account_type: "bank",
  counterparty_legal_name: null,
  source_document: null,
  reconciled: false,
};

function amountField(): HTMLInputElement {
  const el = screen.getByLabelText("Monto (ARS)");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

/** What the server reads from the payload the dialog sent. */
async function savedAmount(): Promise<number | undefined> {
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  return TransactionUpdateSchema.parse(update.mock.calls[0]?.[0]).amount;
}

describe("EditTransactionDialog", () => {
  it("prefills 1234.56 as 1.234,56 and saves it unchanged", async () => {
    render(<EditTransactionDialog transaction={TX} onOpenChange={vi.fn()} />);
    expect(amountField().value).toBe("1.234,56");
    fireEvent.change(screen.getByLabelText("Descripción"), {
      target: { value: "Cobro editado" },
    });
    expect(await savedAmount()).toBe(1234.56);
  });

  it("saves a typed 1.234,56 as 1234.56 and reads a typed dot as the decimal mark", async () => {
    render(
      <EditTransactionDialog
        transaction={{ ...TX, amount: 10 }}
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.change(amountField(), { target: { value: "1234.56" } });
    expect(amountField().value).toBe("1.234,56");
    fireEvent.change(amountField(), { target: { value: "1.234,56" } });
    expect(await savedAmount()).toBe(1234.56);
  });
});
