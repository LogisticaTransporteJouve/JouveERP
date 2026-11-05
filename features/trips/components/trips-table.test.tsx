// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const trip = {
  id: "t1",
  trip_date: "2026-11-01",
  driver: null,
  vehicle: null,
  origin: "Rosario",
  destination: "Córdoba",
  status: "planned",
  revenue: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-trips", () => ({
  useTrips: () => ({ data: [trip] }),
  useDeleteTrip: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./trip-dialog", () => ({ TripDialog: () => null }));

const { TripsTable } = await import("./trips-table");

afterEach(cleanup);

const menuItem = (name: string) =>
  screen.queryByRole("menuitem", { name }) !== null;

describe("TripsTable: write controls follow trips:write", () => {
  it.each([
    ["operations", resolveAccess(["operations"]), true],
    ["driver", resolveAccess(["driver"]), false],
    [
      "operations with trips:write denied",
      resolveAccess(["operations"], ["trips:write"]),
      false,
    ],
  ])("%s gets Nuevo viaje, Editar and Borrar: %s", (_, access, can) => {
    render(
      <TripsTable
        actorAccess={access}
        driverOptions={[]}
        vehicleOptions={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Nuevo viaje/ }) !== null).toBe(
      can,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Acciones" }), {
      key: "Enter",
    });
    expect(menuItem("Ver cargas")).toBe(true);
    expect(menuItem("Editar")).toBe(can);
    expect(menuItem("Borrar")).toBe(can);
  });
});
