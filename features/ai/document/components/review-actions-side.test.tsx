// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, resolveAccess } from "@/lib/auth/permissions";
import type { InvoicingChannelSummary, ScopeSide } from "@/lib/scope";

import type { ExtractionDetail } from "../actions";

const h = vi.hoisted(() => ({ pathname: "/treasury" }));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../hooks/use-documents", () => ({
  usePurchaseInvoiceDraft: () => ({ isError: false, data: undefined }),
  useSubmitPurchaseInvoiceDraft: () => ({}),
}));
vi.mock(
  "@/features/purchase-invoices/components/purchase-invoice-draft-dialog",
  () => ({ PurchaseInvoiceDraftDialog: () => null }),
);
vi.mock("./create-cheques-dialog", () => ({ CreateChequesDialog: () => null }));

// The real create dialogs read the side through these hooks; the stand-ins
// render what they would offer.
async function sideProbe() {
  const { useDefaultChannel, useScope, useSideChannels } =
    await import("@/components/providers/scope-provider");
  return function SideProbe({ name }: { name: string }) {
    const { channels } = useScope();
    const offered = useSideChannels(channels.filter((c) => c.is_active));
    return (
      <div data-testid={name}>
        {offered.map((c) => c.id).join(",")}|default={useDefaultChannel()}
      </div>
    );
  };
}
vi.mock("./create-sales-invoice-dialog", async () => {
  const Probe = await sideProbe();
  return { CreateSalesInvoiceDialog: () => <Probe name="sales" /> };
});
vi.mock("./create-payment-doc-dialog", async () => {
  const Probe = await sideProbe();
  return { CreatePaymentDocDialog: () => <Probe name="payment" /> };
});

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { ReviewActions } = await import("./review-actions");

const CHANNELS: InvoicingChannelSummary[] = [
  { id: "jouve_fiscal", name: "Jouve", is_fiscal: true, is_active: true },
  { id: "jouve_internal", name: "Interno", is_fiscal: false, is_active: true },
];

function extraction(
  detected_type: string,
  matches: Record<string, string | boolean>,
  payload: ExtractionDetail["payload"] = {},
): ExtractionDetail {
  return {
    id: "x1",
    file_id: "f1",
    detected_type,
    confidence: 0.9,
    status: "ready",
    matches,
    created_at: "2026-11-01T00:00:00Z",
    file: null,
    payload,
  };
}

function renderReview(
  detail: ExtractionDetail,
  {
    menu,
    locked = false,
    access = resolveAccess(["finance"]),
  }: { menu: ScopeSide; locked?: boolean; access?: Access },
) {
  render(
    <ScopeProvider
      channels={CHANNELS}
      initialFiscalFilter={menu}
      locked={locked}
    >
      <ReviewActions extraction={detail} access={access} onCreated={() => {}} />
    </ScopeProvider>,
  );
}

beforeEach(() => {
  h.pathname = "/treasury";
});
afterEach(cleanup);

describe("ReviewActions pins the fiscal side", () => {
  it.each([
    ["/treasury", "internal"],
    ["/invoices", "internal"],
    ["/dashboard", "fiscal"],
  ] as const)(
    "on %s with the menu on %s, the sales form offers only fiscal channels",
    (path, menu) => {
      h.pathname = path;
      renderReview(extraction("sales_invoice", { client_id: "c1" }), { menu });
      fireEvent.click(screen.getByText("Emitir factura de venta"));
      expect(screen.getByTestId("sales").textContent).toBe(
        "jouve_fiscal|default=jouve_fiscal",
      );
    },
  );

  it.each([
    ["receipt", { client_id: "c1" }, "Crear recibo"],
    ["payment_order", { supplier_id: "s1" }, "Crear orden de pago"],
  ] as const)(
    "the %s form offers only fiscal channels from Otras ventas",
    (kind, matches, label) => {
      h.pathname = "/receipts";
      renderReview(extraction(kind, matches), { menu: "internal" });
      fireEvent.click(screen.getByText(label));
      expect(screen.getByTestId("payment").textContent).toBe(
        "jouve_fiscal|default=jouve_fiscal",
      );
    },
  );

  it("a fiscal-only user gets the same fiscal-only offer", () => {
    renderReview(extraction("sales_invoice", { client_id: "c1" }), {
      menu: "fiscal",
      locked: true,
    });
    fireEvent.click(screen.getByText("Emitir factura de venta"));
    expect(screen.getByTestId("sales").textContent).toBe(
      "jouve_fiscal|default=jouve_fiscal",
    );
  });
});

describe("ReviewActions offers only what the viewer can create", () => {
  it.each([
    ["check", {}, /Crear cheques/, "No tenés permiso para cargar cheques."],
    [
      "receipt",
      { client_id: "c1" },
      /Crear recibo/,
      "No tenés permiso para cargar recibos.",
    ],
    [
      "payment_order",
      { supplier_id: "s1" },
      /Crear orden de pago/,
      "No tenés permiso para cargar órdenes de pago.",
    ],
    [
      "sales_invoice",
      { client_id: "c1" },
      /Emitir factura/,
      "No tenés permiso para emitir facturas.",
    ],
    [
      "purchase_invoice",
      {},
      /cargar factura de compra/,
      "No tenés permiso para cargar compras.",
    ],
  ] as const)(
    "operations scanning a %s gets the reason, not the button",
    (kind, matches, button, reason) => {
      renderReview(extraction(kind, matches), {
        menu: "fiscal",
        access: resolveAccess(["operations"]),
      });
      expect(screen.queryByRole("button", { name: button })).toBeNull();
      expect(screen.getByText(reason)).toBeTruthy();
    },
  );

  it.each([
    ["receipt", "cliente"],
    ["payment_order", "proveedor"],
    ["sales_invoice", "cliente"],
  ] as const)(
    "a %s whose counterparty was not checked says so, not that it is missing",
    (kind, entity) => {
      renderReview(extraction(kind, { counterparty_unchecked: true }), {
        menu: "fiscal",
      });
      expect(
        screen.getByText(new RegExp(`No se pudo verificar el ${entity}`)),
      ).toBeTruthy();
      expect(screen.queryByText(/No se encontró/)).toBeNull();
    },
  );

  it("a counterparty that was checked and not found keeps the create hint", () => {
    renderReview(
      extraction("receipt", {}, { counterparty_cuit: "20-12345678-9" }),
      { menu: "fiscal" },
    );
    expect(screen.getByText(/No se encontró el cliente por CUIT/)).toBeTruthy();
  });

  it.each([
    ["receipt", "cliente"],
    ["payment_order", "proveedor"],
    ["sales_invoice", "cliente"],
  ] as const)(
    "a %s with no CUIT read says nothing was looked up (audit w13-s6 F1)",
    (kind, entity) => {
      renderReview(extraction(kind, {}), { menu: "fiscal" });
      expect(
        screen.getByText(new RegExp(`No se leyó el CUIT del ${entity}`)),
      ).toBeTruthy();
      expect(screen.queryByText(/No se encontró/)).toBeNull();
    },
  );

  it("finance without accounts:read is told why it cannot create the receipt", () => {
    renderReview(extraction("receipt", { client_id: "c1" }), {
      menu: "fiscal",
      access: resolveAccess(["finance"], ["accounts:read"]),
    });
    expect(screen.queryByRole("button", { name: /Crear recibo/ })).toBeNull();
    expect(screen.getByText(/No tenés permiso para ver cuentas/)).toBeTruthy();
  });
});
