// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExchangeRateCreateSchema } from "../schema";

const create = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({ data: [] }),
  useDeleteExchangeRate: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateExchangeRate: () => ({ mutate: create, isPending: false }),
}));

const { ExchangeRatesPage } = await import("./exchange-rates-page");

afterEach(() => {
  cleanup();
  create.mockReset();
});

function field(label: string): HTMLInputElement {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

describe("ExchangeRatesPage: Cargar cotización", () => {
  it.each([
    ["1.180", "1.180", 1180],
    ["1.180,50", "1.180,50", 1180.5],
    ["1180,123456", "1.180,123456", 1180.123456],
  ])("typing %s shows %s and saves %s", async (typed, shown, saved) => {
    render(<ExchangeRatesPage />);
    fireEvent.click(screen.getByRole("button", { name: /Cargar cotización/ }));
    fireEvent.change(field("Fecha"), { target: { value: "2026-10-01" } });
    fireEvent.change(field("ARS por USD"), { target: { value: typed } });
    expect(field("ARS por USD").value).toBe(shown);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(ExchangeRateCreateSchema.parse(create.mock.calls[0]?.[0]).rate).toBe(
      saved,
    );
  });
});
