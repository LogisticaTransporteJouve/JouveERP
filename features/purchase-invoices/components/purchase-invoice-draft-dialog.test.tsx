// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/dialog";

import type { PurchaseInvoiceDraft } from "../lib/purchase-invoice-draft";

const h = vi.hoisted(() => ({ fetchSignedUrl: vi.fn() }));

vi.mock("@/features/files/hooks/use-attachments", () => ({
  fetchSignedUrl: h.fetchSignedUrl,
}));
vi.mock("./purchase-invoice-form", () => ({
  PurchaseInvoiceForm: () => null,
}));

const { PurchaseInvoiceDraftDialogContent } =
  await import("./purchase-invoice-draft-dialog");

afterEach(cleanup);

const draft: PurchaseInvoiceDraft = {
  data: {
    supplier: null,
    unmatchedSupplier: null,
    kind: "factura",
    kind_read: true,
    letter: null,
    punto_venta: null,
    numero: null,
    fecha: null,
    fch_vto_pago: null,
    cae_proveedor: null,
    cae_vto_proveedor: null,
    imp_neto: null,
    imp_iva: null,
    imp_trib: null,
    imp_total: null,
    moneda: "PES",
    cotizacion: null,
    motivo_nc_nd: null,
    items: [],
    account: null,
    cost_center_id: null,
    warnings: [],
  },
  source: {
    fileId: "f1",
    filename: "factura.pdf",
    mimeType: "application/pdf",
  },
  submitCreate: vi.fn(),
};

describe("PurchaseInvoiceDraftDialogContent source preview", () => {
  it("a failed signed URL stops the spinner and «Reintentar» asks again", async () => {
    h.fetchSignedUrl
      .mockRejectedValueOnce(new Error("storage down"))
      .mockResolvedValueOnce({
        url: "https://example.test/f1",
        filename: "factura.pdf",
        mimeType: "application/pdf",
      });
    render(
      <Dialog open>
        <PurchaseInvoiceDraftDialogContent
          draft={draft}
          onCreated={() => {}}
          onClose={() => {}}
        />
      </Dialog>,
    );
    await screen.findByText("No se pudo cargar el archivo.");
    expect(screen.queryByText("Cargando archivo…")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(h.fetchSignedUrl).toHaveBeenCalledTimes(2));
    await screen.findByTitle("factura.pdf");
  });
});
