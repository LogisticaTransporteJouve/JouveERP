// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodPendingShipment } from "../schema";

const h = vi.hoisted(() => ({
  accounts: {
    data: undefined as unknown[] | undefined,
    isError: false,
    error: null,
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-driver-settlements", () => ({
  useSettlementAccounts: () => h.accounts,
  useSaveDriverSettlement: () => ({ mutate: vi.fn(), isPending: false }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { DriverSettlementDialog } = await import("./driver-settlement-dialog");

afterEach(() => {
  cleanup();
  h.accounts = { data: undefined, isError: false, error: null };
});

const pending: CodPendingShipment[] = [
  {
    shipment_id: "s1",
    driver_id: "d1",
    driver_name: "Chofer",
    remito_number: "0001",
    client_name: "Cliente Uno",
    delivery_date: "2026-11-02",
    origin: null,
    destination: null,
    cod_amount: 1000,
  },
  {
    shipment_id: "s2",
    driver_id: "d1",
    driver_name: "Chofer",
    remito_number: "0002",
    client_name: "Cliente Dos",
    delivery_date: "2026-11-03",
    origin: null,
    destination: null,
    cod_amount: 500,
  },
];

const dialog = () => (
  <DriverSettlementDialog
    driver={{ id: "d1", name: "Chofer" }}
    pending={pending}
    open
    onOpenChange={() => {}}
  />
);

describe("DriverSettlementDialog with accounts that arrive late", () => {
  it("keeps what the user ticked when the default account arrives", () => {
    const { rerender } = render(dialog());
    const [first] = screen.getAllByRole("checkbox");
    if (!first) throw new Error("no checkbox");
    expect(first.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(first);
    expect(first.getAttribute("aria-checked")).toBe("false");

    h.accounts = {
      data: [{ id: "cash1", name: "Caja", type: "cash", currency: "ARS" }],
      isError: false,
      error: null,
    };
    rerender(dialog());

    const [after, second] = screen.getAllByRole("checkbox");
    expect(after?.getAttribute("aria-checked")).toBe("false");
    expect(second?.getAttribute("aria-checked")).toBe("true");
  });
});
