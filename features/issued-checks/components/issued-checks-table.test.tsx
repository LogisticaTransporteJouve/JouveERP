// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";

// «Cobrado» and «Rechazado» book a bank movement, so they need
// transactions:write as well as issued_checks:write
// (ISSUED_CHECK_CASH_PERMISSIONS); «Anular» and editing do not.

vi.mock("../hooks/use-issued-checks", () => ({
  useIssuedChecksList: () => ({
    data: {
      items: [
        {
          id: "ic1",
          kind: "fisico",
          check_number: "1",
          bank_name: "Banco",
          beneficiary_name: "Proveedor",
          beneficiary_cuit: null,
          supplier_legal_name: null,
          due_date: "2026-11-30",
          amount: 100,
          currency: "ARS",
          status: "emitted",
          payment_order_id: null,
        },
      ],
      truncated: false,
    },
  }),
  useTransitionIssuedCheck: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => async () => false,
}));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("./edit-issued-check-dialog", () => ({
  EditIssuedCheckDialog: () => <button>Editar</button>,
}));
vi.mock("./new-issued-check-dialog", () => ({
  NewIssuedCheckDialog: () => <button>Nuevo cheque</button>,
}));

const { IssuedChecksTable } = await import("./issued-checks-table");

afterEach(cleanup);

function renderAs(denied: Permission[]) {
  render(
    <IssuedChecksTable
      accounts={[]}
      channels={[]}
      actorAccess={resolveAccess(["finance"], denied)}
    />,
  );
}

const CASH = ["Marcar cobrado", "Marcar rechazado"];

describe("IssuedChecksTable · cash gate", () => {
  it("offers cobrado and rechazado with issued_checks:write and transactions:write", () => {
    renderAs([]);
    for (const name of CASH) {
      expect(screen.queryAllByRole("button", { name }).length).toBeGreaterThan(
        0,
      );
    }
    expect(screen.queryByText(/necesitás también permiso/)).toBeNull();
  });

  it("hides them, and says why, without transactions:write", () => {
    renderAs(["transactions:write"]);
    for (const name of CASH) {
      expect(screen.queryAllByRole("button", { name })).toHaveLength(0);
    }
    expect(screen.queryAllByRole("button", { name: "Anular" }).length).toBe(
      screen.queryAllByRole("button", { name: "Editar" }).length,
    );
    expect(
      screen.queryAllByRole("button", { name: "Editar" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/necesitás también permiso para cargar movimientos/),
    ).toBeTruthy();
  });

  it("shows no reason to someone without issued_checks:write", () => {
    renderAs(["issued_checks:write"]);
    expect(screen.queryByText(/necesitás también permiso/)).toBeNull();
  });
});
