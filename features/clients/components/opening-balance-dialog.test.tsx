// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setMutate = vi.fn();
const toastError = vi.fn();
// One object per test: a new one each render would re-run the prefill.
let existing = {};

vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-clients", () => ({
  useClientOpeningBalance: () => ({ data: existing }),
  useSetClientOpeningBalance: () => ({ mutate: setMutate, isPending: false }),
  useClearClientOpeningBalance: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { OpeningBalanceDialog } = await import("./opening-balance-dialog");

afterEach(() => {
  cleanup();
  setMutate.mockReset();
  toastError.mockReset();
});

function openAndSave(balance: number): HTMLInputElement {
  existing = {
    opening_date: "2026-10-01",
    target_balance: balance,
    total_settled: 0,
    notes: "saldo legacy",
  };
  render(<OpeningBalanceDialog clientId="c1" prefill />);
  fireEvent.click(screen.getByRole("button", { name: /Ajustar saldo/ }));
  const input = screen.getByPlaceholderText("0,00");
  if (!(input instanceof HTMLInputElement)) throw new Error("not an input");
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  return input;
}

describe("client OpeningBalanceDialog", () => {
  it("saves an unedited prefill with cents as the same amount", () => {
    const input = openAndSave(1234.56);
    expect(input.value).toBe("1.234,56");
    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]?.[0]).toMatchObject({
      client_id: "c1",
      opening_date: "2026-10-01",
      target_balance: 1234.56,
    });
  });

  it("keeps a negative prefill negative, so it is refused, not flipped", () => {
    const input = openAndSave(-1234.56);
    expect(input.value).toBe("-1.234,56");
    expect(setMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Ingresá un saldo válido (no negativo).",
    );
  });
  describe("dollar target", () => {
    function openWithUsd(usd: number | null): HTMLInputElement {
      existing = {
        opening_date: "2026-10-31",
        target_balance: 0,
        total_settled: 0,
        target_balance_usd: usd,
        total_settled_usd: usd === null ? null : 0,
        notes: null,
      };
      render(<OpeningBalanceDialog clientId="c1" prefill />);
      fireEvent.click(screen.getByRole("button", { name: /Ajustar saldo/ }));
      const input = screen.getByPlaceholderText("Sin ajustar");
      if (!(input instanceof HTMLInputElement)) throw new Error("not an input");
      fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
      return input;
    }

    it("prefills and sends the dollar target", () => {
      const input = openWithUsd(1500.5);
      expect(input.value).toBe("1.500,50");
      expect(setMutate.mock.calls[0]?.[0]).toMatchObject({
        target_balance: 0,
        target_balance_usd: 1500.5,
      });
    });

    it("sends null when the dollar field is empty", () => {
      const input = openWithUsd(null);
      expect(input.value).toBe("");
      expect(setMutate.mock.calls[0]?.[0]).toMatchObject({
        target_balance_usd: null,
      });
    });

    it("refuses a negative dollar target", () => {
      openWithUsd(-10);
      expect(setMutate).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(
        "Ingresá un saldo en dólares válido (no negativo).",
      );
    });
  });
});
