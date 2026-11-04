// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoanListItem } from "../schema";

const loan: LoanListItem = {
  id: "l1",
  kind: "prestamo",
  description: "Préstamo banco",
  lender: "Banco",
  principal: 1000,
  currency: "ARS",
  channel_id: "jouve_fiscal",
  channel_name: "Fiscal",
  installments_count: 10,
  first_due_date: "2026-12-01",
  status: "active",
  notes: null,
  created_at: "2026-11-01T00:00:00Z",
  disbursement_transaction_id: null,
  paid_total: 0,
  capital_outstanding: 1000,
  pending_total: 1000,
  pending_count: 10,
  next_due_date: "2026-12-01",
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => async () => false,
}));
vi.mock("../hooks/use-loans", () => ({
  useLoans: () => ({ data: [loan] }),
  useCancelLoan: () => ({ mutate: vi.fn() }),
}));
vi.mock("./loan-dialog", () => ({ LoanDialog: () => null }));

const { LoansTable } = await import("./loans-table");

function openRowMenu() {
  const trigger = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-haspopup") === "menu");
  if (!trigger) throw new Error("row menu not found");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

afterEach(cleanup);

describe("LoansTable gates", () => {
  it("offers create and cancel with accounting:write", () => {
    render(<LoansTable channelOptions={[]} canWrite />);
    expect(screen.getByText("Nuevo préstamo")).toBeTruthy();
    openRowMenu();
    expect(screen.getByText("Anular")).toBeTruthy();
  });

  it("hides both without accounting:write", () => {
    render(<LoansTable channelOptions={[]} canWrite={false} />);
    expect(screen.queryByText("Nuevo préstamo")).toBeNull();
    openRowMenu();
    expect(screen.getByText("Ver cuotas")).toBeTruthy();
    expect(screen.queryByText("Anular")).toBeNull();
  });
});
