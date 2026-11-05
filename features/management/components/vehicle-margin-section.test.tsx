// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VehicleMarginRow } from "../schema";

const row = (over: Partial<VehicleMarginRow>): VehicleMarginRow => ({
  kind: "vehicle",
  vehicleId: "v1",
  patente: "AB123CD",
  isActive: true,
  costCenterId: "c1",
  trips: 2,
  revenue: 0,
  tripCost: 100,
  fuelCost: 0,
  maintenanceCost: 0,
  maintenanceWithoutCost: 0,
  centerCost: 0,
  net: -100,
  marginPct: null,
  pendingUsd: 0,
  uninvoicedShipments: 0,
  ...over,
});

const h = vi.hoisted(() => ({
  read: {
    isPending: false,
    isError: false,
    data: undefined as unknown,
    error: null as Error | null,
  },
}));

vi.mock("../hooks/use-management", () => ({
  useVehicleMargin: () => h.read,
}));

const { VehicleMarginSection } = await import("./vehicle-margin-section");

afterEach(cleanup);

function show() {
  render(
    <VehicleMarginSection
      fromPeriod="2025-10"
      toPeriod="2026-09"
      basis="accrual"
      inflation={false}
      centerLabel={() => "Centro"}
    />,
  );
}

describe("VehicleMarginSection", () => {
  it("marks a net with cargas still to invoice as not final", () => {
    h.read.data = {
      vehicles: [
        row({ uninvoicedShipments: 2 }),
        row({ vehicleId: "v2", patente: "AC456EF" }),
      ],
      withoutVehicle: row({
        kind: "no_vehicle",
        vehicleId: null,
        patente: null,
        uninvoicedShipments: 1,
      }),
      unattributed: [],
      partial: false,
    };
    show();
    expect(screen.getAllByText("pendiente de facturar")).toHaveLength(2);
    expect(
      screen.getByText(
        "3 cargas sin facturar en 2 filas («pendiente de facturar»): no están en el ingreso, así que ese neto no es definitivo.",
      ),
    ).toBeTruthy();
  });

  it("says nothing when every carga is invoiced", () => {
    h.read.data = {
      vehicles: [row({})],
      withoutVehicle: null,
      unattributed: [],
      partial: false,
    };
    show();
    expect(screen.queryByText("pendiente de facturar")).toBeNull();
    expect(screen.queryByText(/sin facturar/)).toBeNull();
  });
});

it("shows the action's error once, not prefixed with itself", () => {
  h.read = {
    isPending: false,
    isError: true,
    data: undefined,
    error: new Error("No se pudo calcular el margen por camión."),
  };
  show();
  expect(
    screen.getByText("No se pudo calcular el margen por camión."),
  ).toBeTruthy();
});
