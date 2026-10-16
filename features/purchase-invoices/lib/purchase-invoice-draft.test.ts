import { describe, expect, it } from "vitest";

import {
  documentTotalGap,
  draftToFormPatch,
  totalsGap,
  type PurchaseInvoiceDraftData,
} from "./purchase-invoice-draft";

const EMPTY: PurchaseInvoiceDraftData = {
  supplier: null,
  unmatchedSupplier: null,
  kind: "factura",
  kind_read: false,
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
};

describe("draftToFormPatch", () => {
  it("keeps the form defaults and marks nothing the document did not have", () => {
    const { patch, filled } = draftToFormPatch(EMPTY, { fecha: "2026-10-16" });
    expect(patch).toMatchObject({
      supplier: null,
      letter: "",
      punto_venta: "",
      numero: "",
      fecha: "2026-10-16",
      imp_neto: "0",
      imp_total: "",
      cotizacion: "1",
      with_items: false,
      items: [],
    });
    expect(filled).toEqual(["moneda"]);
  });

  it("fills and marks the fields read from the document", () => {
    const { patch, filled } = draftToFormPatch(
      {
        ...EMPTY,
        supplier: {
          id: "s1",
          legal_name: "ACME SA",
          display_name: null,
          cuit: "30712345678",
          iva_condition: "responsable_inscripto",
        },
        kind: "nc",
        kind_read: true,
        letter: "B",
        punto_venta: 4,
        numero: 99,
        fecha: "2026-09-01",
        cae_proveedor: "74123456789012",
        imp_neto: 100,
        imp_iva: 21,
        imp_trib: 0,
        imp_total: 121,
        moneda: "DOL",
        cotizacion: 1200,
        items: [
          {
            description: "Flete",
            quantity: 1,
            unit_price: 100,
            iva_rate_id: 5,
          },
        ],
      },
      { fecha: "2026-10-16" },
    );
    expect(patch).toMatchObject({
      letter: "B",
      punto_venta: "4",
      numero: "99",
      fecha: "2026-09-01",
      imp_total: "121",
      moneda: "DOL",
      cotizacion: "1200",
      with_items: true,
      items: [
        {
          description: "Flete",
          quantity: "1",
          unit_price: "100",
          iva_rate_id: 5,
        },
      ],
    });
    expect(filled).toEqual(
      expect.arrayContaining([
        "supplier",
        "letter",
        "punto_venta",
        "numero",
        "fecha",
        "cae_proveedor",
        "imp_total",
        "cotizacion",
        "items",
      ]),
    );
    expect(filled).toContain("kind");
    expect(filled).not.toContain("fch_vto_pago");
  });

  it("leaves the rate empty for a foreign-currency draft without one", () => {
    const { patch, filled } = draftToFormPatch(
      { ...EMPTY, moneda: "DOL" },
      { fecha: "2026-10-16" },
    );
    expect(patch.cotizacion).toBe("");
    expect(filled).not.toContain("cotizacion");
  });
});

describe("totalsGap", () => {
  const base = {
    imp_neto: "100",
    imp_iva: "21",
    imp_trib: "0",
    imp_total: "121",
  };

  it("is null when the amounts close (within a cent)", () => {
    expect(totalsGap(base)).toBeNull();
    expect(totalsGap({ ...base, imp_total: "121.01" })).toBeNull();
  });

  it("returns the difference when they do not", () => {
    expect(totalsGap({ ...base, imp_total: "130" })).toBe(9);
    expect(totalsGap({ ...base, imp_trib: "9" })).toBe(-9);
    expect(totalsGap({ ...base, imp_trib: "9", imp_total: "130" })).toBeNull();
  });

  it("skips an empty or zero total", () => {
    expect(totalsGap({ ...base, imp_total: "" })).toBeNull();
    expect(totalsGap({ ...base, imp_total: "0" })).toBeNull();
  });
});

describe("documentTotalGap", () => {
  it("compares the computed total with the printed one", () => {
    expect(documentTotalGap(1240, 1240)).toBeNull();
    expect(documentTotalGap(1240, 1210)).toBe(30);
    expect(documentTotalGap(null, 1210)).toBeNull();
  });
});
