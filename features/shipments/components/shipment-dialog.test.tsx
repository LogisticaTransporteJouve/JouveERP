// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Shipment } from "../schema";

// «Editar carga» needs only the trips of the options: a failed channel read
// (which only «Facturar flete» uses) leaves the trip picker alone.

const h = vi.hoisted(() => ({
  options: {
    trips: [] as { id: string; trip_date: string; status: string }[] | null,
    channels: [] as { id: string; name: string; is_fiscal: boolean }[] | null,
  },
}));

const shipment: Shipment = {
  id: "s1",
  client_id: null,
  trip_id: null,
  channel_id: null,
  remito_number: null,
  origin: "Rosario",
  destination: "Córdoba",
  description: null,
  scheduled_date: null,
  status: "not_started",
  delivery_date: null,
  failure_reason: null,
  freight_amount: 1000,
  cod_amount: null,
  invoice_id: null,
  invoice_void: false,
  notes: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  client: null,
  trip: null,
};

const idle = { data: undefined, isError: false, isFetching: false };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/invoices/components/client-picker", () => ({
  ClientPicker: () => null,
}));
vi.mock("../hooks/use-shipments", () => ({
  useShipmentOptions: () => ({
    data: h.options,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateShipment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateShipment: () => ({ mutate: vi.fn(), isPending: false }),
  useShipmentRemitoConflict: () => idle,
  useClientFreightTariff: () => idle,
}));

const { ShipmentDialog } = await import("./shipment-dialog");

afterEach(cleanup);

function renderEdit(edited: Shipment = shipment) {
  render(
    <ShipmentDialog
      mode="edit"
      shipment={edited}
      open
      onOpenChange={() => {}}
    />,
  );
}

describe("ShipmentDialog trip picker", () => {
  it("keeps the trips when only the channel read failed", () => {
    h.options = {
      trips: [{ id: "t1", trip_date: "2026-11-01", status: "planned" }],
      channels: null,
    };
    renderEdit();
    expect(screen.queryByText("No se pudieron cargar los viajes.")).toBeNull();
  });

  it("shows a carga's own trip when it is older than the listed ones", () => {
    h.options = {
      trips: [{ id: "t1", trip_date: "2026-11-01", status: "planned" }],
      channels: [],
    };
    renderEdit({
      ...shipment,
      trip_id: "t-old",
      trip: { trip_date: "2025-03-14" },
    });
    const trigger = screen
      .getByText("Viaje")
      .closest("[data-slot=form-item]")
      ?.querySelector("button");
    expect(trigger?.textContent).toContain("2025-03-14");
  });

  it("says the trips could not be read when that read failed", () => {
    h.options = { trips: null, channels: [] };
    renderEdit();
    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los viajes.",
    );
  });
});
