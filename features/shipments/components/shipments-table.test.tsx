// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { Shipment } from "../schema";

const h = vi.hoisted(() => ({
  status: "not_started" as Shipment["status"],
}));

const shipment: Shipment = {
  id: "s1",
  client_id: "c1",
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
  trip: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-shipments", () => ({
  useShipments: () => ({ data: [{ ...shipment, status: h.status }] }),
  useDeleteShipment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./shipment-dialog", () => ({ ShipmentDialog: () => null }));
vi.mock("./shipment-history-dialog", () => ({
  ShipmentHistoryDialog: () => null,
}));
vi.mock("./shipment-status-dialog", () => ({
  ShipmentStatusDialog: () => null,
}));

const { ShipmentsTable } = await import("./shipments-table");

afterEach(() => {
  cleanup();
  h.status = "not_started";
});

function openRowMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Acciones" }), {
    key: "Enter",
  });
}

const menuItem = (name: string) =>
  screen.queryByRole("menuitem", { name }) !== null;

describe("ShipmentsTable: controls follow the actions' permissions", () => {
  it.each([
    ["admin", resolveAccess(["admin"]), true],
    ["operations", resolveAccess(["operations"]), true],
    [
      "operations with shipments:write denied",
      resolveAccess(["operations"], ["shipments:write"]),
      false,
    ],
  ])("%s: write controls %s", (_, access, canWrite) => {
    render(<ShipmentsTable actorAccess={access} />);
    expect(screen.queryByRole("button", { name: /Nueva carga/ }) !== null).toBe(
      canWrite,
    );
    openRowMenu();
    expect(menuItem("Historial")).toBe(true);
    expect(menuItem("Editar")).toBe(canWrite);
    expect(menuItem("Entregar")).toBe(canWrite);
    expect(menuItem("Iniciar")).toBe(false);
    expect(menuItem("Borrar")).toBe(canWrite);
    expect(menuItem("Facturar flete")).toBe(false);
  });
});

describe("ShipmentsTable: columns and row actions", () => {
  it("has no Ruta or Flete column", () => {
    render(<ShipmentsTable actorAccess={resolveAccess(["admin"])} />);
    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());
    expect(headers).not.toContain("Ruta");
    expect(headers).not.toContain("Flete");
    expect(headers).toContain("Cliente");
  });

  it("offers Entregar, not Iniciar, on a carga already in progress", () => {
    h.status = "in_progress";
    render(<ShipmentsTable actorAccess={resolveAccess(["admin"])} />);
    openRowMenu();
    expect(menuItem("Entregar")).toBe(true);
    expect(menuItem("Cancelar")).toBe(true);
    expect(menuItem("Reprogramar")).toBe(true);
    expect(menuItem("Iniciar")).toBe(false);
  });
});
