// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const payment = {
  id: "rp1",
  description: "Alquiler galpón",
  category: "alquiler",
  amount: 1000,
  currency: "ARS",
  frequency: "monthly",
  next_due_date: "2026-12-01",
  is_active: true,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-recurring-payments", () => ({
  useRecurringPayments: () => ({ data: [payment] }),
  useDeleteRecurringPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useSetRecurringPaymentActive: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./recurring-payment-dialog", () => ({
  RecurringPaymentDialog: () => null,
}));

const { RecurringPaymentsTable } = await import("./recurring-payments-table");

afterEach(cleanup);

describe("RecurringPaymentsTable: write controls follow recurring_payments:write", () => {
  it.each([
    ["finance", resolveAccess(["finance"]), true],
    [
      "finance with recurring_payments:write denied",
      resolveAccess(["finance"], ["recurring_payments:write"]),
      false,
    ],
  ])("%s gets Nuevo pago, the row menu and Activo: %s", (_, access, can) => {
    render(<RecurringPaymentsTable actorAccess={access} />);
    expect(screen.getByText("Alquiler galpón")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Nuevo pago/ }) !== null).toBe(
      can,
    );
    expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
      can,
    );
    const toggle = screen.getByRole("switch", { name: "Activo" });
    expect(toggle.hasAttribute("disabled")).toBe(!can);
  });
});
