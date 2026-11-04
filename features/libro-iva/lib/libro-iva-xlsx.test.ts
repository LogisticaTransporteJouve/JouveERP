import { describe, expect, it } from "vitest";

import type { LibroIvaComprasRow, LibroIvaVentasRow } from "../schema";

import { libroIvaComprasSheet, libroIvaVentasSheet } from "./libro-iva-xlsx";

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
  ci: "RI",
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
  channel_name: "Jouve fiscal",
  has_items: true,
  moneda: "PES",
  cotizacion: 1,
  neto_orig: over.neto ?? "100",
  iva_orig: over.iva ?? "21",
  imp_trib_orig: over.imp_trib ?? "0",
  imp_op_ex_orig: over.imp_op_ex ?? "0",
  imp_tot_conc_orig: over.imp_tot_conc ?? "0",
  imp_total_orig: over.imp_total ?? "121",
  ...over,
});

const book = {
  period: "2026-06",
  channelName: "Jouve fiscal",
  generatedAt: "5 jun 2026 10:00",
  header: {
    companyName: "Empresa Test S.A.",
    cuit: "30000000007",
    closed: false,
  },
};

describe("libroIvaVentasSheet", () => {
  it("writes the PDF's header lines and one row per voucher", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [row({}), row({ iva_rate_id: 4, neto: "50", iva: "5.25" })],
    });
    expect(sheet.name).toBe("Libro IVA Ventas 2026-06");
    expect(sheet.preamble?.slice(0, 5)).toEqual([
      "Libro de I.V.A. Ventas (01/06/2026 - 30/06/2026) - Previo",
      "Empresa Test S.A. · C.U.I.T.: 30-00000000-7",
      "Jouve fiscal",
      "1 comprobantes",
      "Generado el 5 jun 2026 10:00",
    ]);
    expect(sheet.rows).toHaveLength(1);
    const headers = sheet.columns.map((c) => c.header);
    // Only the alícuotas the period uses; the legacy lead columns.
    expect(headers).toEqual([
      "Fecha",
      "TC",
      "Comprobante",
      "Razón social",
      "C.U.I.T.",
      "C.I.",
      "Neto 10.5%",
      "IVA 10.5%",
      "Neto 21%",
      "IVA 21%",
      "No gravado",
      "Exento",
      "Percepciones",
      "Total",
      "Moneda orig.",
      "Importe orig.",
      "Cotización",
      "CAE",
    ]);
    const at = (header: string) => sheet.rows[0]?.[headers.indexOf(header)];
    expect(at("Fecha")).toEqual({ date: "2026-06-05" });
    expect(at("TC")).toBe("FC");
    expect(at("Comprobante")).toBe("A0001-00000042");
    expect(at("C.U.I.T.")).toBe("30-71234567-8");
    expect(at("C.I.")).toBe("RI");
    expect(at("Neto 21%")).toEqual({ money: 100, currency: "ARS" });
    expect(at("IVA 10.5%")).toEqual({ money: 5.25, currency: "ARS" });
    expect(at("Total")).toEqual({ money: 121, currency: "ARS" });
    expect(sheet.totals?.[0]).toBe("Totales (1 comprobantes)");
  });

  it("says Definitivo when the period is closed", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      header: { ...book.header, closed: true },
      rows: [row({})],
    });
    expect(sheet.preamble?.[0]).toBe(
      "Libro de I.V.A. Ventas (01/06/2026 - 30/06/2026) - Definitivo",
    );
  });

  it("writes credit notes negative so each column sums to its total", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [
        row({ imp_trib: "10", imp_total: "131" }),
        row({
          invoice_id: "i2",
          kind: "nc",
          numero: 43,
          neto: "40",
          iva: "8.4",
          imp_trib: "2",
          imp_op_ex: "-5",
          imp_total: "50.4",
        }),
      ],
    });
    const headers = sheet.columns.map((c) => c.header);
    const col = (header: string) => headers.indexOf(header);
    const money = (cell: unknown) =>
      cell && typeof cell === "object" && "money" in cell ? cell.money : 0;
    for (const header of ["Neto 21%", "IVA 21%", "Percepciones", "Total"]) {
      const sum = sheet.rows.reduce(
        (acc, r) => acc + Number(money(r[col(header)])),
        0,
      );
      expect(money(sheet.totals?.[col(header)])).toBeCloseTo(sum);
    }
    expect(sheet.rows[1]?.[col("TC")]).toBe("NC");
    expect(sheet.rows[1]?.[col("Total")]).toEqual({
      money: -50.4,
      currency: "ARS",
    });
    expect(sheet.rows[1]?.[col("Percepciones")]).toEqual({
      money: -2,
      currency: "ARS",
    });
    // Every amount of an NC prints with the opposite sign, as stored (-5).
    expect(sheet.rows[1]?.[col("Exento")]).toEqual({
      money: 5,
      currency: "ARS",
    });
    expect(sheet.totals?.[col("Exento")]).toEqual({
      money: 5,
      currency: "ARS",
    });
  });

  it("prints no gravado and exento under their own headings", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [row({ imp_tot_conc: "20", imp_op_ex: "10", imp_total: "151" })],
    });
    const headers = sheet.columns.map((c) => c.header);
    const at = (header: string) => sheet.rows[0]?.[headers.indexOf(header)];
    expect(at("No gravado")).toEqual({ money: 20, currency: "ARS" });
    expect(at("Exento")).toEqual({ money: 10, currency: "ARS" });
    expect(headers).not.toContain("No grav.");
  });

  it("keeps pesos in the book columns and the original currency beside them", () => {
    const usd = {
      kind: "factura",
      moneda: "DOL",
      cotizacion: "1000",
      neto: "100000",
      iva: "21000",
      imp_total: "121000",
      neto_orig: "100",
      iva_orig: "21",
      imp_total_orig: "121",
    };
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [
        row({}),
        row({ ...usd, invoice_id: "u1", numero: 50 }),
        row({
          ...usd,
          invoice_id: "u2",
          numero: 51,
          kind: "nc",
          imp_total: "12100",
          imp_total_orig: "12.1",
        }),
      ],
    });
    const headers = sheet.columns.map((c) => c.header);
    const col = (header: string) => headers.indexOf(header);
    expect(sheet.rows[1]?.[col("Total")]).toEqual({
      money: 121000,
      currency: "ARS",
    });
    expect(sheet.rows[1]?.[col("Moneda orig.")]).toBe("DOL");
    expect(sheet.rows[1]?.[col("Importe orig.")]).toEqual({
      money: 121,
      currency: "USD",
    });
    expect(sheet.rows[1]?.[col("Cotización")]).toBe(1000);
    expect(sheet.rows[2]?.[col("Importe orig.")]).toEqual({
      money: -12.1,
      currency: "USD",
    });
    // Pesos: no original amount, no rate.
    expect(sheet.rows[0]?.[col("Importe orig.")]).toBeNull();
    expect(sheet.totals?.[col("Importe orig.")]).toBeNull();
    expect(sheet.totals?.[col("Total")]).toEqual({
      money: 121 + 121000 - 12100,
      currency: "ARS",
    });
    expect(sheet.preamble).toContain("2 en dólares: USD 108,90 = $ 108.900,00");
  });

  it("writes a voucher without items under its inferred rate, or under Sin alícuota", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [
        row({ iva_rate_id: null, has_items: false }),
        row({
          invoice_id: "i2",
          numero: 43,
          iva_rate_id: null,
          has_items: false,
          neto: "100",
          iva: "15",
          imp_total: "115",
        }),
      ],
    });
    const headers = sheet.columns.map((c) => c.header);
    const col = (header: string) => headers.indexOf(header);
    expect(sheet.rows[0]?.[col("IVA 21%")]).toEqual({
      money: 21,
      currency: "ARS",
    });
    expect(sheet.rows[1]?.[col("IVA Sin alícuota")]).toEqual({
      money: 15,
      currency: "ARS",
    });
    expect(sheet.totals?.[col("IVA 21%")]).toEqual({
      money: 21,
      currency: "ARS",
    });
  });

  it("warns about foreign vouchers left at rate 1", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [row({ moneda: "DOL", cotizacion: "1" })],
    });
    expect(sheet.preamble).toContainEqual(
      expect.stringMatching(/sin cotización \(cotización 1\)/),
    );
  });
});

const compra = (over: Partial<LibroIvaComprasRow>): LibroIvaComprasRow => ({
  purchase_invoice_id: "p1",
  fecha: "2026-09-01",
  kind: "factura",
  letter: "A",
  punto_venta: 840,
  numero: 686943,
  supplier_legal_name: "Proveedor Peaje SA",
  supplier_cuit: "30711111118",
  cae_proveedor: null,
  cae_vto_proveedor: null,
  iva_rate_id: 5,
  iva_rate_pct: 21,
  neto: 17746.86,
  iva: 3726.84,
  imp_trib: 842.98,
  imp_total: 22316.68,
  channel_id: "jouve_fiscal",
  channel_name: "Jouve fiscal",
  has_items: true,
  moneda: "PES",
  cotizacion: 1,
  neto_orig: 17746.86,
  iva_orig: 3726.84,
  imp_trib_orig: 842.98,
  imp_total_orig: 22316.68,
  no_gravado: 0,
  exentas: 0,
  perc_iva: 532.41,
  perc_iibb: 310.57,
  perc_nacionales: 0,
  perc_municipales: 0,
  impuestos_internos: 0,
  no_gravado_orig: 0,
  exentas_orig: 0,
  perc_iva_orig: 532.41,
  perc_iibb_orig: 310.57,
  perc_nacionales_orig: 0,
  perc_municipales_orig: 0,
  impuestos_internos_orig: 0,
  ...over,
});

describe("libroIvaComprasSheet", () => {
  it("writes the perceptions in one column, with each one's code beside", () => {
    const sheet = libroIvaComprasSheet({
      ...book,
      rows: [
        compra({}),
        compra({
          purchase_invoice_id: "nc",
          kind: "nc",
          perc_iva: 0,
          perc_iibb: 0,
          perc_nacionales: 10,
          imp_trib: 10,
        }),
      ],
    });
    const headers = sheet.columns.map((c) => c.header);
    const col = (header: string) => headers.indexOf(header);
    for (const gone of ["Perc. IVA", "Perc. IIBB", "Otros trib."]) {
      expect(headers).not.toContain(gone);
    }
    expect(sheet.rows[0]?.[col("Percepciones")]).toEqual({
      money: 842.98,
      currency: "ARS",
    });
    expect(sheet.rows[0]?.[col("Detalle percepciones")]).toBe(
      "310,57 B · 532,41 I",
    );
    expect(sheet.rows[1]?.[col("Detalle percepciones")]).toBe("-10,00 G");
    expect(sheet.totals?.[col("Percepciones")]).toEqual({
      money: 832.98,
      currency: "ARS",
    });
  });
});
