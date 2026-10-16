import { describe, expect, it } from "vitest";

import type { LibroIvaVentasRow } from "../schema";

import { libroIvaVentasSheet } from "./libro-iva-xlsx";

const row = (over: Partial<LibroIvaVentasRow>): LibroIvaVentasRow => ({
  invoice_id: "i1",
  fecha: "2026-06-05",
  kind: "factura",
  letter: "A",
  punto_venta: 1,
  numero: 42,
  cbte_tipo_afip: 1,
  client_legal_name: "Acme S.A.",
  doc_tipo: 80,
  doc_nro: "30712345678",
  cae: "76123456789012",
  cae_vencimiento: null,
  iva_rate_id: 5,
  iva_rate_pct: 21,
  neto: "100",
  iva: "21",
  imp_trib: "0",
  imp_op_ex: "0",
  imp_tot_conc: "0",
  imp_total: "121",
  channel_id: "c1",
  channel_name: "DZ Instalaciones",
  has_items: true,
  ...over,
});

describe("libroIvaVentasSheet", () => {
  it("writes one row per voucher, codes as text, amounts as ARS", () => {
    const sheet = libroIvaVentasSheet({
      period: "2026-06",
      rows: [row({}), row({ iva_rate_id: 4, neto: "50", iva: "5.25" })],
    });
    expect(sheet.name).toBe("IVA Ventas 2026-06");
    expect(sheet.rows).toHaveLength(1);
    const headers = sheet.columns.map((c) => c.header);
    const at = (header: string) => sheet.rows[0]?.[headers.indexOf(header)];
    expect(at("Fecha")).toEqual({ date: "2026-06-05" });
    expect(at("Comprobante")).toBe("A0001-00000042");
    expect(at("CUIT")).toBe("30712345678");
    expect(at("Neto 21%")).toEqual({ money: 100, currency: "ARS" });
    expect(at("IVA 10.5%")).toEqual({ money: 5.25, currency: "ARS" });
    expect(at("Neto 27%")).toBeNull();
    expect(at("Total")).toEqual({ money: 121, currency: "ARS" });
    expect(sheet.totals?.[0]).toBe("Totales (1 comprobantes)");
  });
});
