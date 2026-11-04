// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";

// The row and toolbar writes move treasury money, so they need
// transactions:write as well as cheques:write (CHECK_CASH_PERMISSIONS).

function check(id: string, status: string) {
  return {
    id,
    kind: "fisico",
    check_number: id,
    bank_name: "Banco",
    drawer_name: "Firmante",
    source_client_legal_name: null,
    due_date: "2026-11-30",
    amount: 100,
    currency: "ARS",
    status,
  };
}

vi.mock("../hooks/use-checks", () => ({
  useChecksList: () => ({
    data: {
      items: [check("c1", "en_cartera"), check("c2", "depositado")],
      truncated: false,
    },
  }),
}));
vi.mock("@/hooks/use-realtime-invalidate", () => ({
  useRealtimeInvalidate: () => {},
}));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("./check-action-dialogs", () => ({
  DepositChequeDialog: () => <button>Depositar</button>,
  CreditChequeDialog: () => <button>Acreditar</button>,
  RejectChequeDialog: () => <button>Rechazar</button>,
}));
vi.mock("./new-check-dialog", () => ({
  NewChequeDialog: () => <button>Nuevo cheque</button>,
}));
vi.mock("./sell-checks-dialog", () => ({ SellChequesDialog: () => null }));

const { ChequesTable } = await import("./checks-table");

afterEach(cleanup);

function renderAs(denied: Permission[]) {
  render(
    <ChequesTable
      channels={[]}
      actorAccess={resolveAccess(["finance"], denied)}
    />,
  );
}

const WRITES = ["Depositar", "Acreditar", "Rechazar", "Nuevo cheque"];

describe("ChequesTable · cash gate", () => {
  it("offers every write with cheques:write and transactions:write", () => {
    renderAs([]);
    for (const name of WRITES) {
      expect(screen.queryAllByRole("button", { name }).length).toBeGreaterThan(
        0,
      );
    }
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.queryByText(/necesitás también permiso/)).toBeNull();
  });

  it("hides them, and says why, without transactions:write", () => {
    renderAs(["transactions:write"]);
    for (const name of WRITES) {
      expect(screen.queryAllByRole("button", { name })).toHaveLength(0);
    }
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.getByText(/necesitás también permiso para cargar movimientos/),
    ).toBeTruthy();
  });

  it("shows no reason to someone without cheques:write", () => {
    renderAs(["cheques:write"]);
    expect(screen.queryByText(/necesitás también permiso/)).toBeNull();
  });
});
