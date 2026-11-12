// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Shipment } from "../schema";

// The carga form asks for client, description, tipo, both addresses (origin /
// destination), both days, horario and observaciones (notes); the trip is
// assigned from the trip.

const shipment: Shipment = {
  id: "s1",
  client_id: null,
  trip_id: null,
  channel_id: null,
  remito_number: "0001-00001234",
  kind: "mudanza",
  origin: "Rosario",
  destination: "Av. Pellegrini 1500, Rosario",
  description: "Pallets",
  scheduled_date: "2026-11-12",
  unload_date: "2026-11-13",
  time_window: "8 a 12 hs",
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
  it("shows the carga's fields in order, filled from the carga", () => {
    render(
      <ShipmentDialog
        mode="edit"
        shipment={shipment}
        open
        onOpenChange={() => {}}
      />,
    );
    const labels = [
      "Cliente",
      "Descripción",
      "Tipo",
      "Dirección de carga",
      "Dirección de descarga",
      "Fecha de carga",
      "Fecha de descarga",
      "Horario",
      "Observaciones",
    ];
    const shown = Array.from(document.querySelectorAll("label")).map(
      (l) => l.textContent,
    );
    expect(shown.filter((l) => l !== null && labels.includes(l))).toEqual(
      labels,
    );
    for (const gone of [
      "Remito del cliente",
      "Flete",
      "Cobranza contra entrega",
      "Viaje",
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(
      screen.getByDisplayValue("Av. Pellegrini 1500, Rosario"),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("Rosario")).toBeTruthy();
    expect(screen.getByDisplayValue("8 a 12 hs")).toBeTruthy();
    expect(screen.getByDisplayValue("nota vieja")).toBeTruthy();
  });
});
