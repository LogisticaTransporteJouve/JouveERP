// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The origin picker of a purchase NC/ND: a failed search says so with
// «Reintentar», not «Sin facturas para este proveedor.».

const h = vi.hoisted(() => ({ refetch: vi.fn() }));

vi.mock("../hooks/use-purchase-invoices", () => ({
  usePurchaseInvoicesSearch: () => ({
    data: undefined,
    isFetching: false,
    isError: true,
    refetch: h.refetch,
  }),
}));

const { PurchaseInvoicePicker } = await import("./purchase-invoice-picker");

afterEach(cleanup);

describe("PurchaseInvoicePicker", () => {
  it("a failed search says so with «Reintentar»", () => {
    render(
      <PurchaseInvoicePicker
        value={null}
        onChange={() => {}}
        supplierId="s1"
        channelId="c1"
      />,
    );
    fireEvent.focus(screen.getByRole("textbox"));
    expect(
      screen.getByText("No se pudieron buscar las facturas."),
    ).toBeTruthy();
    expect(screen.queryByText(/Sin facturas/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.refetch).toHaveBeenCalledOnce();
  });
});
