// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: {
    data: undefined as unknown,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock("../hooks/use-treasury", () => ({ useTreasurySummary: () => h.read }));
vi.mock("@/features/hr/components/employee-cash-dialog", () => ({
  EmployeeCashDialog: () => null,
}));
vi.mock("@/features/payment-orders/components/pay-dialog", () => ({
  PayDialog: () => null,
}));
vi.mock("@/features/receipts/components/collect-dialog", () => ({
  CollectDialog: () => null,
}));

const { TreasuryPage } = await import("./treasury-page");

afterEach(cleanup);

describe("TreasuryPage", () => {
  it("shows a failed summary read with «Reintentar», not $0 and no accounts", () => {
    render(<TreasuryPage />);
    expect(
      screen.getByText("No se pudo cargar el resumen de tesorería."),
    ).toBeTruthy();
    expect(screen.queryByText("Total ARS líquido")).toBeNull();
    expect(screen.queryByText("Sin cuentas para el filtro actual.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.read.refetch).toHaveBeenCalled();
  });
});
