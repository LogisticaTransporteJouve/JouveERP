import { describe, expect, it } from "vitest";

import { computeLineAmounts, computeTotals } from "@/features/invoices/schema";
import { CONDICION_IVA_RECEPTOR } from "@/lib/afip/codes";
import { round2 } from "@/lib/format";

import {
  discriminatesIva,
  invoicePerRate,
  invoiceTotalsRows,
  itemSubtotal,
  itemUnitPrice,
} from "./invoice-figures";
import {
  carriesTransparencyRegime,
  isFacturaBToConsumidorFinal,
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

describe("item subtotals", () => {
  const lines = [
    { quantity: 3, unit_price: 100, iva_rate_id: 5 as const },
    { quantity: 2, unit_price: 333.33, iva_rate_id: 4 as const },
  ];
  const totals = computeTotals(lines, true);
  const items = lines.map((l) => ({
    description: "Flete",
    ...l,
    ...computeLineAmounts(l, true),
  }));
  const issued = (letter: "A" | "B") => ({
    ...voucher(letter, CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL),
    items,
    imp_neto: totals.imp_neto,
    imp_iva: totals.imp_iva,
    imp_total: totals.imp_total,
    per_rate: invoicePerRate(
      { isFiscal: true, imp_neto: totals.imp_neto, imp_iva: totals.imp_iva },
      items,
    ),
  });
  const sumLines = (data: InvoiceTemplateData) =>
    Math.round(
      data.items.reduce((s, it) => s + itemSubtotal(data, it), 0) * 100,
    ) / 100;

  it("on an A, each line is quantity × net price and the lines add up to the Subtotal", () => {
    const a = issued("A");
    expect(itemSubtotal(a, a.items[0]!)).toBe(300);
    expect(sumLines(a)).toBe(
      invoiceTotalsRows(a).find((r) => r.label === "Subtotal")?.amount,
    );
  });

  it("on a B, the lines carry IVA and add up to the Subtotal before tributos", () => {
    const b = issued("B");
    expect(itemSubtotal(b, b.items[0]!)).toBe(363);
    expect(sumLines(b)).toBe(b.imp_total);
    const withTrib = {
      ...b,
      imp_trib: 12.5,
      imp_total: round2(b.imp_total + 12.5),
    };
    expect(sumLines(withTrib)).toBe(
      invoiceTotalsRows(withTrib).find((r) => r.label === "Subtotal")?.amount,
    );
  });
});

describe("invoicePerRate", () => {
  it("adds the items per rate, low id first", () => {
    expect(
      invoicePerRate({ isFiscal: true, imp_neto: 1100, imp_iva: 126 }, [
        { iva_rate_id: 5, line_neto: 100, line_iva: 21 },
        { iva_rate_id: 4, line_neto: 1000, line_iva: 105 },
        { iva_rate_id: 5, line_neto: 50, line_iva: 10.5 },
      ]),
    ).toEqual([
      { id: 4, base: 1000, importe: 105 },
      { id: 5, base: 150, importe: 31.5 },
    ]);
  });

  it("puts an itemless fiscal header under the rate the book infers, or none", () => {
    expect(
      invoicePerRate({ isFiscal: true, imp_neto: 100, imp_iva: 21 }, []),
    ).toEqual([{ id: 5, base: 100, importe: 21 }]);
    expect(
      invoicePerRate({ isFiscal: true, imp_neto: 100, imp_iva: 17 }, []),
    ).toEqual([]);
    expect(
      invoicePerRate({ isFiscal: false, imp_neto: 100, imp_iva: 0 }, []),
    ).toEqual([]);
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
