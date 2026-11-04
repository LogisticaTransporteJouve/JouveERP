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

vi.mock("../hooks/use-treasury", () => ({ useCashFlow: () => h.read }));
vi.mock("../lib/treasury-queries", () => ({
  CASH_FLOW_MONTHS: { back: 3, fwd: 6 },
}));

const { CashFlowPage } = await import("./cash-flow-page");

afterEach(cleanup);

describe("CashFlowPage", () => {
  it("shows a failed read with «Reintentar» instead of a skeleton", () => {
    render(<CashFlowPage />);
    expect(
      screen.getByText("No se pudo cargar el flujo de caja."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.read.refetch).toHaveBeenCalled();
  });
});
