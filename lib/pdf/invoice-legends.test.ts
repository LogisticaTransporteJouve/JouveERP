import { describe, expect, it } from "vitest";

import { CONDICION_IVA_RECEPTOR } from "@/lib/afip/codes";

import {
  carriesTransparencyRegime,
  discriminatesIva,
  invoiceTotalsRows,
  isFacturaBToConsumidorFinal,
  itemUnitPrice,
  isLetterAToMonotributo,
  type InvoiceTemplateData,
} from "./invoice-template";

function voucher(
  letter: "A" | "B",
  condicion: number | null,
  isFiscal = true,
): InvoiceTemplateData {
  return {
    isFiscal,
    emittedAt: "2026-10-01T12:00:00-03:00",
    emisor: {
      legal_name: "Emisor S.A.",
      cuit: "30000000007",
      iva_condition: "IVA Responsable Inscripto",
      address: null,
      division_label: "Logística Jouve",
      iibb_number: null,
      inicio_actividades: null,
    },
    receptor: {
      legal_name: "Cliente",
      doc_tipo_label: "CUIT",
      doc_nro: "20000000001",
      iva_condition_label: "—",
      condicion_iva_receptor: condicion,
      address: null,
    },
    kind: "factura",
    letter,
    punto_venta: 3,
    numero: 1,
    fecha: "2026-10-16",
    fch_serv_desde: null,
    fch_serv_hasta: null,
    fch_vto_pago: null,
    concepto_label: "Servicios",
    items: [],
    imp_neto: 100,
    imp_iva: 21,
    imp_trib: 0,
    imp_tot_conc: 0,
    imp_op_ex: 0,
    imp_total: 121,
    per_rate: [],
    moneda: "PES",
    cotizacion: 1,
    cae: "70000000000000",
    cae_vencimiento: "2026-10-26",
    qr_data_url: null,
  };
}

describe("invoice legends", () => {
  it("prints the transparency regime on every fiscal B, the other national taxes only to a consumidor final", () => {
    for (const condicion of [
      CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
      CONDICION_IVA_RECEPTOR.EXENTO,
    ]) {
      expect(carriesTransparencyRegime(voucher("B", condicion))).toBe(true);
    }
    expect(
      carriesTransparencyRegime({ ...voucher("B", null), kind: "nc" }),
    ).toBe(true);
    expect(carriesTransparencyRegime(voucher("A", null))).toBe(false);
    expect(carriesTransparencyRegime(voucher("B", null, false))).toBe(false);
    expect(
      isFacturaBToConsumidorFinal(
        voucher("B", CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL),
      ),
    ).toBe(true);
    expect(
      isFacturaBToConsumidorFinal(voucher("B", CONDICION_IVA_RECEPTOR.EXENTO)),
    ).toBe(false);
  });

  it("prints the Ley 27.618 legend only on an A to a monotributista", () => {
    expect(
      isLetterAToMonotributo(voucher("A", CONDICION_IVA_RECEPTOR.MONOTRIBUTO)),
    ).toBe(true);
    expect(
      isLetterAToMonotributo(
        voucher("A", CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO),
      ),
    ).toBe(false);
    expect(
      isLetterAToMonotributo(
        voucher("A", CONDICION_IVA_RECEPTOR.MONOTRIBUTO, false),
      ),
    ).toBe(false);
  });
});

const item = {
  description: "Flete",
  quantity: 3,
  unit_price: 100,
  iva_rate_id: 5 as const,
  line_neto: 300,
  line_total: 363,
};

describe("invoice totals", () => {
  const sum = (rows: { amount: number }[]) =>
    Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  it("an A itemizes neto and IVA per rate, adding up to the total", () => {
    const a = {
      ...voucher("A", null),
      per_rate: [{ id: 5 as const, base: 100, importe: 21 }],
    };
    expect(invoiceTotalsRows(a)).toEqual([
      { label: "Subtotal", amount: 100 },
      { label: "IVA 21%", amount: 21 },
    ]);
    expect(sum(invoiceTotalsRows(a))).toBe(a.imp_total);
    expect(itemUnitPrice(a, item)).toBe(100);
  });

  it("an itemless A without a known rate still shows its IVA", () => {
    const a = { ...voucher("A", null), per_rate: [] };
    expect(invoiceTotalsRows(a)).toContainEqual({ label: "IVA", amount: 21 });
    expect(sum(invoiceTotalsRows(a))).toBe(a.imp_total);
  });

  it("a B does not discriminate IVA: no neto or IVA rows, prices with IVA", () => {
    const b = {
      ...voucher("B", CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL),
      per_rate: [{ id: 5 as const, base: 100, importe: 21 }],
    };
    expect(discriminatesIva(b)).toBe(false);
    expect(invoiceTotalsRows(b)).toEqual([]);
    expect(itemUnitPrice(b, item)).toBe(121);
    expect(
      invoiceTotalsRows({ ...b, imp_trib: 3.3, imp_total: 124.3 }),
    ).toEqual([
      { label: "Subtotal", amount: 121 },
      { label: "Otros tributos", amount: 3.3 },
    ]);
  });
});

describe("invoice PDF bytes", () => {
  it("renders the same invoice to the same hash", async () => {
    const { createHash } = await import("node:crypto");
    const { renderInvoicePdf } = await import("./render");
    const hash = async () =>
      createHash("sha256")
        .update(await renderInvoicePdf(voucher("A", null)))
        .digest("hex");
    const first = await hash();
    await new Promise((r) => setTimeout(r, 1100));
    expect(await hash()).toBe(first);
  });

  it("renders a B with items and an itemless A", async () => {
    const { renderInvoicePdf } = await import("./render");
    const b = {
      ...voucher("B", CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL),
      items: [item],
    };
    expect((await renderInvoicePdf(b)).length).toBeGreaterThan(0);
    expect((await renderInvoicePdf(voucher("A", null))).length).toBeGreaterThan(
      0,
    );
  });
});
