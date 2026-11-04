// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExchangeRateCreateSchema } from "../schema";

const create = vi.fn();
const confirm = vi.fn();
const h = vi.hoisted(() => ({
  rates: [] as {
    id: string;
    currency: string;
    rate_date: string;
    rate: number;
    source: string;
    notes: string | null;
    created_at: string;
  }[],
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => confirm,
}));
vi.mock("../hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({ data: h.rates }),
  useDeleteExchangeRate: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateExchangeRate: () => ({ mutate: create, isPending: false }),
}));

const { ExchangeRatesPage } = await import("./exchange-rates-page");

afterEach(() => {
  cleanup();
  create.mockReset();
  confirm.mockReset();
  h.rates = [];
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

  describe("a rate far from the stored one asks first", () => {
    const stored = {
      id: "r1",
      currency: "USD",
      rate_date: "2026-09-30",
      rate: 1450,
      source: "bcra",
      notes: null,
      created_at: "2026-09-30T12:00:00Z",
    };

    function save(typed: string) {
      render(<ExchangeRatesPage />);
      fireEvent.click(
        screen.getByRole("button", { name: /Cargar cotización/ }),
      );
      fireEvent.change(field("Fecha"), { target: { value: "2026-10-01" } });
      fireEvent.change(field("ARS por USD"), { target: { value: typed } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    }

    it("1450.125 read as 1.450.125 is not saved unless confirmed", async () => {
      h.rates = [stored];
      confirm.mockResolvedValue(false);
      save("1450.125");
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(confirm.mock.calls[0]?.[0].description).toMatch(
        /La última cotización fue 1\.450,00/,
      );
      expect(create).not.toHaveBeenCalled();
    });

    it("saves it when confirmed", async () => {
      h.rates = [stored];
      confirm.mockResolvedValue(true);
      save("1450.125");
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(create.mock.calls[0]?.[0].rate).toBe(1_450_125);
    });

    it("a normal move saves without asking", async () => {
      h.rates = [stored];
      save("1.480,50");
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
