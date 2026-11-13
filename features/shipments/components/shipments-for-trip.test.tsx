// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Shipment } from "../schema";

// The trip page's cargas: each row offers the cargas list's status actions
// (through the same ShipmentStatusDialog) and shows the carga's tipo and
// addresses compactly.

const h = vi.hoisted(() => ({
  status: "in_progress" as Shipment["status"],
  dialog: [] as Array<{ action: string | null; id: string | null }>,
}));

const shipment: Shipment = {
  id: "s1",
  client_id: "c1",
  trip_id: "t1",
  channel_id: null,
  remito_number: null,
  kind: "mudanza",
  origin: "Depósito Norte",
  destination: "Av. Siempreviva 742",
  description: null,
  scheduled_date: "2026-11-12",
  unload_date: "2026-11-13",
  time_window: "8 a 12 hs",
  status: "in_progress",
  delivery_date: null,
  failure_reason: null,
  freight_amount: null,
  invoice_id: null,
  invoice_void: false,
  notes: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  client: {
    legal_name: "Acme",
    display_name: null,
    cuit: null,
    iva_condition: null,
    is_fiscal: false,
  },
  trip: { trip_date: "2026-11-12" },
};

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("../hooks/use-shipments", () => ({
  useShipmentsByTrip: () => ({
    data: [{ ...shipment, status: h.status }],
    isLoading: false,
    isError: false,
  }),
  useSetShipmentsTrip: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./assign-shipments-dialog", () => ({
  AssignShipmentsDialog: () => null,
}));
vi.mock("./shipment-status-dialog", () => ({
  ShipmentStatusDialog: ({
    shipment: s,
    action,
  }: {
    shipment: Shipment | null;
    action: string | null;
  }) => {
    h.dialog.push({ action, id: s?.id ?? null });
    return null;
  },
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { ShipmentsForTrip } = await import("./shipments-for-trip");

afterEach(() => {
  cleanup();
  h.dialog.length = 0;
});

describe("ShipmentsForTrip", () => {
  it("shows the tipo, both addresses, the unload day and the horario", () => {
    render(<ShipmentsForTrip tripId="t1" canWrite />);
    expect(screen.getByText("Mudanza")).toBeTruthy();
    expect(
      screen.getByText("Depósito Norte → Av. Siempreviva 742"),
    ).toBeTruthy();
    expect(screen.getByText("Descarga 13-11-2026 · 8 a 12 hs")).toBeTruthy();
  });

  it("opens the shared status dialog with the picked action", () => {
    render(<ShipmentsForTrip tripId="t1" canWrite />);
    const trigger = screen.getByRole("button", { name: "Cambiar estado" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    for (const label of ["Entregar", "Cancelar", "Reprogramar"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("menuitem", { name: "Reprogramar" }));
    expect(h.dialog.at(-1)).toEqual({ action: "reprogram", id: "s1" });
  });

  it("offers no status change on a delivered carga, nor anything read-only", () => {
    h.status = "delivered";
    render(<ShipmentsForTrip tripId="t1" canWrite />);
    expect(screen.queryByRole("button", { name: "Cambiar estado" })).toBeNull();
    cleanup();
    h.status = "in_progress";
    render(<ShipmentsForTrip tripId="t1" canWrite={false} />);
    expect(screen.queryByRole("button", { name: "Cambiar estado" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Quitar del viaje" }),
    ).toBeNull();
  });
});
