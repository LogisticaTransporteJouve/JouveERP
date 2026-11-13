// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { Shipment } from "../schema";

const h = vi.hoisted(() => ({
  status: "not_started" as Shipment["status"],
  empty: false,
  filters: [] as unknown[],
  setUrl: () => {},
}));

const shipment: Shipment = {
  id: "s1",
  client_id: "c1",
  trip_id: null,
  channel_id: null,
  remito_number: null,
  kind: "carga",
  unload_date: null,
  time_window: null,
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
  useShipments: (filter: unknown) => {
    h.filters.push(filter);
    return { data: h.empty ? [] : [{ ...shipment, status: h.status }] };
  },
  useDeleteShipment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-url-filter", () => ({ useUrlFilter: () => h.setUrl }));
vi.mock("@/features/clients/hooks/use-clients", () => ({
  useClientByIdOptional: () => ({ data: undefined }),
}));
vi.mock("@/features/invoices/components/client-picker", () => ({
  ClientPicker: () => null,
}));
vi.mock("./shipment-dialog", () => ({ ShipmentDialog: () => null }));
vi.mock("./shipment-history-dialog", () => ({
  ShipmentHistoryDialog: () => null,
}));
vi.mock("./shipment-status-dialog", () => ({
  ShipmentStatusDialog: () => null,
}));

const { ShipmentsTable: Table } = await import("./shipments-table");
const { DEFAULT_SHIPMENT_LIST_PARAMS } = await import("../lib/list-params");

function ShipmentsTable({
  actorAccess,
  initialParams = DEFAULT_SHIPMENT_LIST_PARAMS,
}: {
  actorAccess: Parameters<typeof Table>[0]["actorAccess"];
  initialParams?: Parameters<typeof Table>[0]["initialParams"];
}) {
  return <Table actorAccess={actorAccess} initialParams={initialParams} />;
}

afterEach(() => {
  cleanup();
  h.status = "not_started";
  h.empty = false;
  h.filters = [];
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

describe("ShipmentsTable: filters", () => {
  it("reads the list with the URL's filters, server-side", () => {
    render(
      <ShipmentsTable
        actorAccess={resolveAccess(["operations"])}
        initialParams={{
          ...DEFAULT_SHIPMENT_LIST_PARAMS,
          statuses: ["not_started", "in_progress"],
          trip: "sin",
        }}
      />,
    );
    expect(h.filters.at(-1)).toEqual({
      statuses: ["not_started", "in_progress"],
      assigned: false,
    });
    expect(screen.getByText("No iniciada + En curso")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Limpiar/ })).toBeTruthy();
  });

  it("says no carga matches the filters when the filtered list is empty", () => {
    h.empty = true;
    render(
      <ShipmentsTable
        actorAccess={resolveAccess(["operations"])}
        initialParams={{ ...DEFAULT_SHIPMENT_LIST_PARAMS, trip: "asignada" }}
      />,
    );
    expect(screen.getByText("No hay cargas con estos filtros.")).toBeTruthy();
  });

  it("has no Limpiar and reads every carga with no filter", () => {
    render(<ShipmentsTable actorAccess={resolveAccess(["operations"])} />);
    expect(h.filters.at(-1)).toEqual({});
    expect(screen.queryByRole("button", { name: /Limpiar/ })).toBeNull();
  });
});
