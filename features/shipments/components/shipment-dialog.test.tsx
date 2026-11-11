// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Shipment } from "../schema";

// The carga form asks only for client, description, scheduled date and
// dirección (the destination column); the trip is assigned from the trip.

const shipment: Shipment = {
  id: "s1",
  client_id: null,
  trip_id: null,
  channel_id: null,
  remito_number: "0001-00001234",
  origin: "Rosario",
  destination: "Av. Pellegrini 1500, Rosario",
  description: "Pallets",
  scheduled_date: null,
  status: "not_started",
  delivery_date: null,
  failure_reason: null,
  freight_amount: 1000,
  invoice_id: null,
  invoice_void: false,
  notes: "nota vieja",
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  client: null,
  trip: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/invoices/components/client-picker", () => ({
  ClientPicker: () => null,
}));
vi.mock("../hooks/use-shipments", () => ({
  useCreateShipment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateShipment: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { ShipmentDialog } = await import("./shipment-dialog");

afterEach(cleanup);

describe("ShipmentDialog", () => {
  it("shows only Cliente, Descripción, Fecha programada and Dirección", () => {
    render(
      <ShipmentDialog
        mode="edit"
        shipment={shipment}
        open
        onOpenChange={() => {}}
      />,
    );
    for (const label of [
      "Cliente",
      "Descripción",
      "Fecha programada",
      "Dirección",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const gone of [
      "Remito del cliente",
      "Origen",
      "Flete",
      "Cobranza contra entrega",
      "Notas",
      "Viaje",
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(
      screen.getByDisplayValue("Av. Pellegrini 1500, Rosario"),
    ).toBeTruthy();
  });
});
