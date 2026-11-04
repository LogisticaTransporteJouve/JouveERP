// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountCreateSchema,
  AccountUpdateSchema,
  type Account,
} from "../schema";

const create = vi.fn();
const update = vi.fn();

vi.mock("../hooks/use-accounts", () => ({
  useAccountHasMovements: () => ({
    data: false,
    isPending: false,
    isError: false,
  }),
  useCreateAccount: () => ({ mutate: create, isPending: false }),
  useUpdateAccount: () => ({ mutate: update, isPending: false }),
}));

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { AccountForm } = await import("./account-form");

afterEach(() => {
  cleanup();
  create.mockReset();
  update.mockReset();
});

const ACCOUNT: Account = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Banco Galicia",
  type: "bank",
  currency: "ARS",
  is_active: true,
  notes: null,
  opening_balance: 1234.56,
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-10-01T00:00:00Z",
};

function balanceField(): HTMLInputElement {
  const el = screen.getByLabelText("Saldo inicial");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

describe("AccountForm opening balance", () => {
  it.each([
    [1234.56, "1.234,56"],
    [-1234.56, "-1.234,56"],
  ])("prefills %s as %s and saves it unchanged", async (balance, shown) => {
    render(
      <AccountForm
        mode="edit"
        account={{ ...ACCOUNT, opening_balance: balance }}
      />,
    );
    expect(balanceField().value).toBe(shown);
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Banco Galicia CC" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(
      AccountUpdateSchema.parse(update.mock.calls[0]?.[0]).opening_balance,
    ).toBe(balance);
  });

  it("saves a typed -1.234,56 as -1234.56 and drops a typed dot in sight", async () => {
    render(<AccountForm mode="create" />);
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Caja" },
    });
    fireEvent.change(balanceField(), { target: { value: "1234.56" } });
    expect(balanceField().value).toBe("123.456");
    fireEvent.change(balanceField(), { target: { value: "-1.234,56" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(
      AccountCreateSchema.parse(create.mock.calls[0]?.[0]).opening_balance,
    ).toBe(-1234.56);
  });
});
