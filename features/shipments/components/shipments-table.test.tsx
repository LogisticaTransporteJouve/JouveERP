// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { Shipment } from "../schema";

const h = vi.hoisted(() => ({
  channels: [] as { id: string; name: string; is_fiscal: boolean }[],
  posChannel: null as string | null,
  optionsFailed: false,
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
  cod_amount: null,
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
  useShipments: () => ({ data: [shipment] }),
  useDeleteShipment: () => ({ mutate: vi.fn(), isPending: false }),
  useShipmentOptions: () =>
    h.optionsFailed
      ? { data: undefined, isError: true, refetch: vi.fn() }
      : { data: { trips: [], channels: h.channels }, isError: false },
  useInvoiceFreight: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/invoices/components/pos-select", () => ({
  PosSelect: ({ channelId }: { channelId: string | null }) => {
    h.posChannel = channelId;
    return null;
  },
}));
vi.mock("./shipment-dialog", () => ({ ShipmentDialog: () => null }));
vi.mock("./shipment-history-dialog", () => ({
  ShipmentHistoryDialog: () => null,
}));
vi.mock("./shipment-status-dialog", () => ({
  ShipmentStatusDialog: () => null,
}));

const { ShipmentsTable } = await import("./shipments-table");
const { FreightInvoiceDialog } = await import("./freight-invoice-dialog");

afterEach(() => {
  cleanup();
  h.channels = [];
  h.posChannel = null;
  h.optionsFailed = false;
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
    ["admin", resolveAccess(["admin"]), true, true],
    ["operations", resolveAccess(["operations"]), true, false],
    [
      "admin with invoices:issue denied",
      resolveAccess(["admin"], ["invoices:issue"]),
      true,
      false,
    ],
    [
      "operations with shipments:write denied",
      resolveAccess(["operations"], ["shipments:write"]),
      false,
      false,
    ],
  ])(
    "%s: write controls %s, Facturar flete %s",
    (_, access, canWrite, canInvoice) => {
      render(<ShipmentsTable actorAccess={access} />);
      expect(
        screen.queryByRole("button", { name: /Nueva carga/ }) !== null,
      ).toBe(canWrite);
      openRowMenu();
      expect(menuItem("Historial")).toBe(true);
      expect(menuItem("Editar")).toBe(canWrite);
      expect(menuItem("Iniciar")).toBe(canWrite);
      expect(menuItem("Borrar")).toBe(canWrite);
      expect(menuItem("Facturar flete")).toBe(canInvoice);
    },
  );
});

describe("FreightInvoiceDialog: channel on the client's side", () => {
  const bothChannels = [
    { id: "jouve_fiscal", name: "Jouve", is_fiscal: true },
    { id: "jouve_internal", name: "Jouve interno", is_fiscal: false },
  ];

  it("preselects the only channel on the client's side", () => {
    h.channels = bothChannels;
    render(<FreightInvoiceDialog shipment={shipment} onClose={() => {}} />);
    expect(h.posChannel).toBe("jouve_internal");
  });

  it("lists only the client's side channels", () => {
    h.channels = [
      ...bothChannels,
      { id: "other_internal", name: "Otro interno", is_fiscal: false },
    ];
    render(<FreightInvoiceDialog shipment={shipment} onClose={() => {}} />);
    // Two left on the internal side: nothing is preselected.
    expect(h.posChannel).toBeNull();
    // Radix Select needs these in jsdom.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => {};
    Element.prototype.scrollIntoView ??= () => {};
    fireEvent.click(screen.getByRole("combobox"));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Jouve interno", "Otro interno"]);
  });

  it("says the channels could not be read instead of an empty select", () => {
    h.optionsFailed = true;
    render(<FreightInvoiceDialog shipment={shipment} onClose={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los canales.",
    );
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeTruthy();
  });

  it("keeps the carga's own channel", () => {
    h.channels = bothChannels;
    render(
      <FreightInvoiceDialog
        shipment={{ ...shipment, channel_id: "jouve_fiscal" }}
        onClose={() => {}}
      />,
    );
    expect(h.posChannel).toBe("jouve_fiscal");
  });
});
