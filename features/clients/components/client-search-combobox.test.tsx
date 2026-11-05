// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The endosante search: a failed search says so with «Reintentar», not
// «Sin resultados.».

const h = vi.hoisted(() => ({ refetch: vi.fn() }));

vi.mock("../hooks/use-clients", () => ({
  useClientsSearch: () => ({
    data: undefined,
    isFetching: false,
    isError: true,
    refetch: h.refetch,
  }),
}));

const { ClientSearchCombobox } = await import("./client-search-combobox");

beforeAll(() => {
  // cmdk measures and scrolls its list; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe("ClientSearchCombobox", () => {
  it("a failed search says so with «Reintentar», not «Sin resultados.»", () => {
    render(<ClientSearchCombobox value="" label="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("Buscar cliente…"), {
      target: { value: "acme" },
    });
    expect(
      screen.getByText("No se pudieron buscar los clientes."),
    ).toBeTruthy();
    expect(screen.queryByText("Sin resultados.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.refetch).toHaveBeenCalledOnce();
  });
});
