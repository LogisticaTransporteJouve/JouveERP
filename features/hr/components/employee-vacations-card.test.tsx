// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

type Read = {
  data: unknown[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

const ok = (data: unknown[]): Read => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});
const failed = (): Read => ({
  data: undefined,
  isLoading: false,
  isError: true,
  refetch: vi.fn(),
});

const h = vi.hoisted(() => ({
  balances: undefined as unknown,
  leaves: undefined as unknown,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-vacations", () => ({
  useVacationBalances: () => h.balances,
  useEmployeeLeaves: () => h.leaves,
  useCreateLeave: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLeave: () => ({ mutate: vi.fn(), isPending: false }),
  useSetVacationOpening: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { EmployeeVacationsCard } = await import("./employee-vacations-card");

afterEach(cleanup);

function renderCard() {
  render(
    <EmployeeVacationsCard
      employeeId="e1"
      employeeName="Juan Pérez"
      hireDate="2020-03-01"
      actorAccess={resolveAccess(["owner"])}
    />,
  );
}

describe("EmployeeVacationsCard", () => {
  it("shows a failed balances read with «Reintentar» and no «Cargar saldo»", () => {
    const balances = failed();
    h.balances = balances;
    h.leaves = ok([]);
    renderCard();
    expect(screen.getByText("No se pudieron leer los saldos.")).toBeTruthy();
    expect(screen.queryByText(/Sin saldos/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Cargar saldo/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(balances.refetch).toHaveBeenCalled();
  });

  it("shows a failed leaves read instead of «Sin licencias» and hides the new-leave form", () => {
    h.balances = ok([]);
    h.leaves = failed();
    renderCard();
    expect(screen.getByText("No se pudieron leer las licencias.")).toBeTruthy();
    expect(screen.queryByText("Sin licencias registradas.")).toBeNull();
    expect(screen.queryByText("Nueva licencia")).toBeNull();
  });

  it("offers «Cargar saldo» and the empty states once both reads work", () => {
    h.balances = ok([]);
    h.leaves = ok([]);
    renderCard();
    expect(screen.getByText(/Sin saldos/)).toBeTruthy();
    expect(screen.getByText("Sin licencias registradas.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cargar saldo/ })).toBeTruthy();
  });
});
