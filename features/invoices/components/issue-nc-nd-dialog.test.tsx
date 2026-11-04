// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OriginInvoice } from "./issue-nc-nd-dialog";

const issue = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("../hooks/use-invoices", () => ({
  useIssueFiscalInvoice: () => ({ mutate: issue, isPending: false }),
}));

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { NcNdForm } = await import("./issue-nc-nd-dialog");

afterEach(() => {
  cleanup();
  issue.mockReset();
});

const ORIGIN: OriginInvoice = {
  id: "inv1",
  channel_id: "ch1",
  letter: "A",
  punto_venta: 3,
  fecha: "2026-10-01",
  concepto: 2,
  moneda: "DOL",
  cotizacion: 1180.5,
  doc_nro: "30712345678",
  client: {
    id: "c1",
    legal_name: "Cliente SA",
    iva_condition: "responsable_inscripto",
  },
  items: [
    { description: "Flete", quantity: 1, unit_price: 100, iva_rate_id: 5 },
  ],
};

function rateField(): HTMLInputElement {
  const el = screen.getByLabelText("Cotización DOL");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

async function savedRate(): Promise<unknown> {
  fireEvent.change(screen.getByPlaceholderText(/devolución de servicios/), {
    target: { value: "Bonificación" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Emitir NC" }));
  await vi.waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
  return issue.mock.calls[0]?.[0]?.cotizacion;
}

describe("NcNdForm cotización", () => {
  it("prefills the origin's 1180.5 as 1.180,50 and saves it unchanged", async () => {
    render(<NcNdForm origin={ORIGIN} kind="nc" />);
    expect(rateField().value).toBe("1.180,50");
    expect(await savedRate()).toBe(1180.5);
  });

  it.each([
    ["1.180", 1180],
    ["1.180,50", 1180.5],
  ])("saves a typed %s as %s", async (typed, saved) => {
    render(<NcNdForm origin={{ ...ORIGIN, cotizacion: 1000 }} kind="nc" />);
    fireEvent.change(rateField(), { target: { value: typed } });
    expect(await savedRate()).toBe(saved);
  });
});
