// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/features/accounts/schema";

import { ManualChequeCreateSchema } from "../schema";

const create = vi.fn();

const CARTERA: Account = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Cheques en cartera",
  type: "checks",
  currency: "ARS",
  is_active: true,
  notes: null,
  opening_balance: 0,
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-10-01T00:00:00Z",
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/features/accounts/hooks/use-accounts", () => ({
  useAccountsList: () => ({ data: [CARTERA] }),
}));
vi.mock("../hooks/use-checks", () => ({
  useCreateCheque: () => ({ mutate: create, isPending: false }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const { NewChequeDialog } = await import("./new-check-dialog");

afterEach(() => {
  cleanup();
  create.mockReset();
});

function type(label: string, text: string): HTMLInputElement {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  fireEvent.change(el, { target: { value: text } });
  return el;
}

describe("NewChequeDialog amount", () => {
  it("saves a typed 1.234,56 as 1234.56 and drops a typed dot in sight", async () => {
    render(
      <NewChequeDialog
        channels={[{ id: "ch1", name: "Jouve fiscal", is_active: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Nuevo cheque/ }));
    type("Número de check", "00012345");
    type("Banco emisor", "Banco Galicia");
    type("Firmante (razón social)", "Cliente SRL");
    const channel = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("Jouve fiscal"));
    fireEvent.change(channel!, { target: { value: "ch1" } });
    expect(type("Monto", "1234.56").value).toBe("123.456");
    type("Monto", "1.234,56");
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(
      ManualChequeCreateSchema.parse(create.mock.calls[0]?.[0]).amount,
    ).toBe(1234.56);
  });
});
