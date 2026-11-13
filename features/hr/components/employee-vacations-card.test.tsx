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
  holidays: [] as string[],
  today: "2026-11-06",
}));

vi.mock("@/lib/format", async (orig) => ({
  ...(await orig<typeof import("@/lib/format")>()),
  todayInAR: () => h.today,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-vacations", () => ({
  useVacationBalances: () => h.balances,
  useEmployeeLeaves: () => h.leaves,
  useHolidayDates: () => ({ data: h.holidays }),
  useCreateLeave: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLeave: () => ({ mutate: vi.fn(), isPending: false }),
  useSetVacationOpening: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { EmployeeVacationsCard } = await import("./employee-vacations-card");

afterEach(() => {
  cleanup();
  h.holidays = [];
  h.today = "2026-11-06";
});

const balance = (remaining: number) => ({
  id: "b1",
  employee_id: "e1",
  period_year: 2026,
  entitled_days: 14,
  bonus_days: 0,
  carryover_days: 0,
  used_days: 14 - remaining,
  remaining_days: remaining,
  granted_at: "2026-10-01",
  expires_at: "2027-04-30",
  status: "active",
});

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

  it("warns, without blocking, on a vacation that starts off Monday and exceeds the balance", () => {
    h.today = "2026-12-09"; // a Wednesday: the form starts a 1-day leave today
    h.balances = ok([balance(0)]);
    h.leaves = ok([]);
    renderCard();
    expect(
      screen.getByText(/Empieza el miércoles 09-12-2026: por la LCT/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "La licencia es de 1 día y le quedan 0 días de vacaciones pendientes.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Registrar/ })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("shows no warning on a Monday within the balance", () => {
    h.today = "2026-12-07";
    h.balances = ok([balance(10)]);
    h.leaves = ok([]);
    renderCard();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("takes the next working day when the Monday is a holiday", () => {
    h.today = "2026-12-08";
    h.holidays = ["2026-12-07"];
    h.balances = ok([balance(10)]);
    h.leaves = ok([]);
    renderCard();
    expect(screen.queryByText(/Empieza el/)).toBeNull();
  });
});
