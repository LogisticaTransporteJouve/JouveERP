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

vi.mock("../hooks/use-fleet-reports", () => ({
  useFleetProfitability: () => h.read,
}));

const { ProfitabilityReport } = await import("./profitability-report");

afterEach(cleanup);

describe("ProfitabilityReport", () => {
  it("shows a failed read with «Reintentar» instead of a skeleton", () => {
    render(<ProfitabilityReport />);
    expect(
      screen.getByText("No se pudo cargar la rentabilidad de flota."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.read.refetch).toHaveBeenCalled();
  });
});
