// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setMutate = vi.fn();
// One object per test: a new one each render would re-run the prefill.
let existing = {};

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-accounts", () => ({
  useAccountOpeningBalance: () => ({ data: existing }),
  useSetAccountOpeningBalance: () => ({ mutate: setMutate, isPending: false }),
  useClearAccountOpeningBalance: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { AccountOpeningBalanceDialog } =
  await import("./account-opening-balance-dialog");

afterEach(() => {
  cleanup();
  setMutate.mockReset();
});

const CHANNEL = { id: "ch1", name: "Jouve fiscal" };

function input(): HTMLInputElement {
  const el = screen.getByPlaceholderText("0,00");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

function open(balance: number) {
  existing = {
    adjustment_date: "2026-10-01",
    target_balance: balance,
    channel_id: CHANNEL.id,
    notes: null,
  };
  render(
    <AccountOpeningBalanceDialog
      accountId="a1"
      accountName="Banco"
      currency="ARS"
      channels={[CHANNEL]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Editar saldo/ }));
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
}

describe("AccountOpeningBalanceDialog", () => {
  it.each([
    [1234.56, "1.234,56"],
    [-1234.56, "-1.234,56"],
  ])("saves an unedited prefill of %s as the same amount", (balance, shown) => {
    open(balance);
    expect(input().value).toBe(shown);
    save();
    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]?.[0]).toMatchObject({
      account_id: "a1",
      adjustment_date: "2026-10-01",
      target_balance: balance,
      channel_id: CHANNEL.id,
    });
  });

  it("keeps a typed minus and formats the rest", () => {
    open(0);
    fireEvent.change(input(), { target: { value: "-1500,5" } });
    expect(input().value).toBe("-1.500,5");
    save();
    expect(setMutate.mock.calls[0]?.[0]).toMatchObject({
      target_balance: -1500.5,
    });
  });
});
