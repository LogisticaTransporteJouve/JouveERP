// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: {
    data: undefined as unknown,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock("../hooks/use-shipments", () => ({
  useShipmentHistory: () => h.read,
}));

const { ShipmentHistoryDialog } = await import("./shipment-history-dialog");

afterEach(cleanup);

describe("ShipmentHistoryDialog", () => {
  it("shows a failed read with «Reintentar», not «Sin cambios de estado»", () => {
    render(<ShipmentHistoryDialog shipmentId="s1" onClose={() => {}} />);
    expect(
      screen.getByText("No se pudo cargar el historial de estados."),
    ).toBeTruthy();
    expect(screen.queryByText("Sin cambios de estado.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.read.refetch).toHaveBeenCalled();
  });
});
