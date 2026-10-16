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
  channelName: "DZ Fiscal",
  generatedAt: "5 jun 2026 10:00",
};

describe("libroIvaVentasSheet", () => {
  it("writes the PDF's header lines and one row per voucher", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [row({}), row({ iva_rate_id: 4, neto: "50", iva: "5.25" })],
    });
    expect(sheet.name).toBe("Libro IVA Ventas 2026-06");
    expect(sheet.preamble).toEqual([
      "Libro IVA Ventas — 2026-06",
      "DZ Fiscal",
      "1 comprobantes",
      "Generado el 5 jun 2026 10:00",
    ]);
    expect(sheet.rows).toHaveLength(1);
    const headers = sheet.columns.map((c) => c.header);
    const at = (header: string) => sheet.rows[0]?.[headers.indexOf(header)];
    expect(at("Fecha")).toEqual({ date: "2026-06-05" });
    expect(at("Comprobante")).toBe("A0001-00000042");
    expect(at("CUIT")).toBe("30712345678");
    expect(at("Neto 21%")).toEqual({ money: 100, currency: "ARS" });
    expect(at("IVA 10.5%")).toEqual({ money: 5.25, currency: "ARS" });
    expect(at("Neto 27%")).toBeNull();
    expect(at("Total $")).toEqual({ money: 121, currency: "ARS" });
    expect(sheet.totals?.[0]).toBe("Totales (1 comprobantes)");
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
    for (const header of ["Neto 21%", "IVA 21%", "Perc.", "Total $"]) {
      const sum = sheet.rows.reduce(
        (acc, r) => acc + Number(money(r[col(header)])),
        0,
      );
      expect(money(sheet.totals?.[col(header)])).toBeCloseTo(sum);
    }
    expect(sheet.rows[1]?.[col("Total $")]).toEqual({
      money: -50.4,
      currency: "ARS",
    });
    expect(sheet.rows[1]?.[col("Perc.")]).toEqual({
      money: -2,
      currency: "ARS",
    });
    // The PDF hides a non-positive No grav.; so does the sheet.
    expect(sheet.rows[1]?.[col("No grav.")]).toBeNull();
    expect(sheet.totals?.[col("No grav.")]).toBeNull();
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
    expect(sheet.rows[1]?.[col("Total $")]).toEqual({
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
    expect(sheet.totals?.[col("Total $")]).toEqual({
      money: 121 + 121000 - 12100,
      currency: "ARS",
    });
    expect(sheet.preamble).toContain("2 en dólares: USD 108,90 = $ 108.900,00");
  });

  it("warns about foreign vouchers left at rate 1", () => {
    const sheet = libroIvaVentasSheet({
      ...book,
      rows: [row({ moneda: "DOL", cotizacion: "1" })],
    });
    expect(sheet.preamble?.at(-1)).toMatch(/sin cotización \(cotización 1\)/);
  });
});
