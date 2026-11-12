// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const trip = {
  id: "t1",
  trip_date: "2026-11-01",
  driver: null,
  vehicle: null,
  status: "planned",
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

describe("TripsTable: «Ver cargas» follows shipments:read", () => {
  it("the driver, who cannot read cargas, gets no actions menu", () => {
    render(
      <TripsTable
        actorAccess={resolveAccess(["driver"])}
        driverOptions={[]}
        vehicleOptions={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Nuevo viaje/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Acciones" })).toBeNull();
  });

  it("operations with shipments:read denied keeps Editar, not Ver cargas", () => {
    render(
      <TripsTable
        actorAccess={resolveAccess(["operations"], ["shipments:read"])}
        driverOptions={[]}
        vehicleOptions={[]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Acciones" }), {
      key: "Enter",
    });
    expect(menuItem("Ver cargas")).toBe(false);
    expect(menuItem("Editar")).toBe(true);
  });
});

describe("TripsTable: columns", () => {
  it("shows only date, driver, companion, vehicle and status", () => {
    render(
      <TripsTable
        actorAccess={resolveAccess(["operations"])}
        driverOptions={[]}
        vehicleOptions={[]}
      />,
    );
    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim())
      .filter(Boolean);
    expect(headers).toEqual([
      "Fecha",
      "Chofer",
      "Acompañante",
      "Vehículo",
      "Estado",
    ]);
  });
});
