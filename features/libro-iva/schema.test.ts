import { describe, expect, it } from "vitest";

import {
  IVA_RATES,
  computeComprasTotals,
  computeTotals,
  countSuspectRates,
  foreignCurrencyTotals,
  groupByInvoice,
  groupComprasByInvoice,
  type LibroIvaComprasRow,
  type LibroIvaVentasRow,
} from "./schema";

describe("IVA_RATES (AFIP iva_rate_id → alícuota)", () => {
  it("maps id 8 → 5% and id 9 → 2.5% (matching lib/afip/codes.ts, not swapped)", () => {
    const byId = new Map(IVA_RATES.map((r) => [r.id, r.pct]));
    expect(byId.get(8)).toBe(5);
    expect(byId.get(9)).toBe(2.5);
    expect(byId.get(4)).toBe(10.5);
    expect(byId.get(5)).toBe(21);
    expect(byId.get(6)).toBe(27);
    expect(byId.get(3)).toBe(0);
  });
});

const baseCompraRow = (
  over: Partial<LibroIvaComprasRow>,
): LibroIvaComprasRow => ({
  purchase_invoice_id: "pi-1",
  fecha: "2026-05-01",
  kind: "factura",
  letter: "A",
  punto_venta: 1,
  numero: 700,
  supplier_legal_name: "YPF SA",
  supplier_cuit: "30599999998",
  cae_proveedor: "999",
  cae_vto_proveedor: "2026-05-31",
  iva_rate_id: 5,
  iva_rate_pct: 21,
  neto: 1000,
  iva: 210,
  imp_trib: 0,
  imp_total: 1210,
  channel_id: "dz_fiscal",
  channel_name: "DZ Fiscal",
  has_items: true,
  moneda: "PES",
  cotizacion: 1,
  neto_orig: over.neto ?? 1000,
  iva_orig: over.iva ?? 210,
  imp_trib_orig: over.imp_trib ?? 0,
  imp_total_orig: over.imp_total ?? 1210,
  ...over,
});

describe("groupComprasByInvoice", () => {
  it("agrupa filas por purchase_invoice_id con per_rate", () => {
    const rows: LibroIvaComprasRow[] = [
      baseCompraRow({
        purchase_invoice_id: "a",
        iva_rate_id: 5,
        neto: 1500,
        iva: 315,
      }),
      baseCompraRow({
        purchase_invoice_id: "a",
        iva_rate_id: 4,
        neto: 500,
        iva: 52.5,
      }),
      baseCompraRow({
        purchase_invoice_id: "b",
        iva_rate_id: 5,
        neto: 800,
        iva: 168,
      }),
    ];
    const grouped = groupComprasByInvoice(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.per_rate[5]).toEqual({ neto: 1500, iva: 315 });
    expect(grouped[0]!.per_rate[4]).toEqual({ neto: 500, iva: 52.5 });
  });

  it("usa key -1 cuando iva_rate_id es null", () => {
    const grouped = groupComprasByInvoice([
      baseCompraRow({
        purchase_invoice_id: "x",
        iva_rate_id: null,
        neto: 1000,
        iva: 210,
        has_items: false,
      }),
    ]);
    expect(grouped[0]!.per_rate[-1]).toEqual({ neto: 1000, iva: 210 });
    expect(grouped[0]!.has_items).toBe(false);
  });
});

describe("computeComprasTotals", () => {
  it("acumula neto/iva por alícuota y totales del header", () => {
    const grouped = groupComprasByInvoice([
      baseCompraRow({
        purchase_invoice_id: "a",
        iva_rate_id: 5,
        neto: 1000,
        iva: 210,
        imp_total: 1210,
      }),
      baseCompraRow({
        purchase_invoice_id: "b",
        iva_rate_id: 4,
        neto: 500,
        iva: 52.5,
        imp_trib: 30,
        imp_total: 582.5,
      }),
    ]);
    const totals = computeComprasTotals(grouped);
    expect(totals.count).toBe(2);
    expect(totals.per_rate[5]).toEqual({ neto: 1000, iva: 210 });
    expect(totals.per_rate[4]).toEqual({ neto: 500, iva: 52.5 });
    expect(totals.imp_trib).toBe(30);
    expect(totals.imp_total).toBe(1792.5);
  });
});

const baseRow = (over: Partial<LibroIvaVentasRow>): LibroIvaVentasRow => ({
  invoice_id: "inv-1",
  fecha: "2026-05-01",
  kind: "factura",
  letter: "A",
  punto_venta: 1,
  numero: 100,
  cbte_tipo_afip: 1,
  client_legal_name: "Cliente SA",
  doc_tipo: 80,
  doc_nro: "30999999999",
  cae: "12345",
  cae_vencimiento: "2026-05-15",
  iva_rate_id: 5,
  iva_rate_pct: 21,
  neto: 1000,
  iva: 210,
  imp_trib: 30,
  imp_op_ex: 0,
  imp_tot_conc: 0,
  imp_total: 1240,
  channel_id: "dz_fiscal",
  channel_name: "DZ Fiscal",
  has_items: true,
  moneda: "PES",
  cotizacion: 1,
  neto_orig: over.neto ?? 1000,
  iva_orig: over.iva ?? 210,
  imp_trib_orig: over.imp_trib ?? 30,
  imp_op_ex_orig: over.imp_op_ex ?? 0,
  imp_tot_conc_orig: over.imp_tot_conc ?? 0,
  imp_total_orig: over.imp_total ?? 1240,
  ...over,
});

describe("groupByInvoice", () => {
  it("agrupa filas por invoice_id", () => {
    const rows = [
      baseRow({ invoice_id: "a", iva_rate_id: 5, neto: 1000, iva: 210 }),
      baseRow({ invoice_id: "a", iva_rate_id: 4, neto: 200, iva: 21 }),
      baseRow({ invoice_id: "b", iva_rate_id: 5, neto: 500, iva: 105 }),
    ];
    const grouped = groupByInvoice(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.per_rate[5]).toEqual({ neto: 1000, iva: 210 });
    expect(grouped[0]!.per_rate[4]).toEqual({ neto: 200, iva: 21 });
    expect(grouped[1]!.per_rate[5]).toEqual({ neto: 500, iva: 105 });
  });

  it("usa key -1 cuando iva_rate_id es null (sin desglose)", () => {
    const rows = [
      baseRow({ invoice_id: "x", iva_rate_id: null, neto: 800, iva: 168 }),
    ];
    const grouped = groupByInvoice(rows);
    expect(grouped[0]!.per_rate[-1]).toEqual({ neto: 800, iva: 168 });
    expect(grouped[0]!.has_items).toBe(true);
  });

  it("suma múltiples filas con la misma alícuota", () => {
    const rows = [
      baseRow({ invoice_id: "a", iva_rate_id: 5, neto: 500, iva: 105 }),
      baseRow({ invoice_id: "a", iva_rate_id: 5, neto: 300, iva: 63 }),
    ];
    const grouped = groupByInvoice(rows);
    expect(grouped[0]!.per_rate[5]).toEqual({ neto: 800, iva: 168 });
  });
});

describe("computeTotals", () => {
  it("acumula por alícuota y agrega totales del header", () => {
    const grouped = groupByInvoice([
      baseRow({
        invoice_id: "a",
        iva_rate_id: 5,
        neto: 1000,
        iva: 210,
        imp_trib: 30,
        imp_total: 1240,
      }),
      baseRow({
        invoice_id: "b",
        iva_rate_id: 4,
        neto: 200,
        iva: 21,
        imp_trib: 0,
        imp_total: 221,
      }),
    ]);
    const totals = computeTotals(grouped);
    expect(totals.count).toBe(2);
    expect(totals.per_rate[5]).toEqual({ neto: 1000, iva: 210 });
    expect(totals.per_rate[4]).toEqual({ neto: 200, iva: 21 });
    expect(totals.imp_trib).toBe(30);
    expect(totals.imp_total).toBe(1461);
  });

  it("resta las notas de crédito (kind=nc) del IVA débito", () => {
    const grouped = groupByInvoice([
      baseRow({
        invoice_id: "a",
        kind: "factura",
        iva_rate_id: 5,
        neto: 1000,
        iva: 210,
        imp_trib: 0,
        imp_total: 1210,
      }),
      baseRow({
        invoice_id: "b",
        kind: "nc",
        iva_rate_id: 5,
        neto: 400,
        iva: 84,
        imp_trib: 0,
        imp_total: 484,
      }),
    ]);
    const totals = computeTotals(grouped);
    expect(totals.per_rate[5]).toEqual({ neto: 600, iva: 126 });
    expect(totals.imp_total).toBe(726);
  });
});

// A USD invoice as the RPC returns it: peso columns already converted at the
// document's cotizacion (1000), originals in *_orig.
const usdVenta = (over: Partial<LibroIvaVentasRow> = {}): LibroIvaVentasRow =>
  baseRow({
    invoice_id: "usd",
    moneda: "DOL",
    cotizacion: "1000.0000",
    neto: 100_000,
    iva: 21_000,
    imp_trib: 0,
    imp_total: 121_000,
    neto_orig: 100,
    iva_orig: 21,
    imp_trib_orig: 0,
    imp_total_orig: 121,
    ...over,
  });

describe("libro IVA in pesos (multicurrency)", () => {
  it("keeps the peso figures for the book and the originals apart", () => {
    const [g] = groupByInvoice([usdVenta()]);
    expect(g!.per_rate[5]).toEqual({ neto: 100_000, iva: 21_000 });
    expect(g!.imp_total).toBe(121_000);
    expect(g!.moneda).toBe("DOL");
    expect(g!.cotizacion).toBe(1000);
    expect(g!.orig.per_rate[5]).toEqual({ neto: 100, iva: 21 });
    expect(g!.orig.imp_total).toBe(121);
  });

  it("totals add pesos only: a USD invoice counts at its cotizacion", () => {
    const totals = computeTotals(
      groupByInvoice([
        baseRow({ invoice_id: "ars", imp_trib: 0, imp_total: 1210 }),
        usdVenta(),
      ]),
    );
    expect(totals.per_rate[5]).toEqual({ neto: 101_000, iva: 21_210 });
    expect(totals.imp_total).toBe(122_210);
  });

  it("groups foreign documents per currency, credit notes subtracting", () => {
    const grouped = groupByInvoice([
      baseRow({ invoice_id: "ars" }),
      usdVenta(),
      usdVenta({
        invoice_id: "usd-nc",
        kind: "nc",
        imp_total: 12_100,
        imp_total_orig: 12.1,
      }),
    ]);
    expect(foreignCurrencyTotals(grouped)).toEqual([
      {
        moneda: "DOL",
        count: 2,
        imp_total_orig: 108.9,
        imp_total_ars: 108_900,
      },
    ]);
  });

  it("flags foreign documents stored without a real cotizacion", () => {
    const grouped = groupByInvoice([
      baseRow({ invoice_id: "ars" }),
      usdVenta(),
      usdVenta({ invoice_id: "bad", cotizacion: 1 }),
    ]);
    expect(countSuspectRates(grouped)).toBe(1);
  });

  it("purchases: same split for compras", () => {
    const [g] = groupComprasByInvoice([
      baseCompraRow({
        moneda: "DOL",
        cotizacion: 950,
        neto: 95_000,
        iva: 19_950,
        imp_total: 114_950,
        neto_orig: 100,
        iva_orig: 21,
        imp_total_orig: 121,
      }),
    ]);
    expect(g!.per_rate[5]).toEqual({ neto: 95_000, iva: 19_950 });
    expect(g!.orig.per_rate[5]).toEqual({ neto: 100, iva: 21 });
    expect(foreignCurrencyTotals([g!])).toEqual([
      { moneda: "DOL", count: 1, imp_total_orig: 121, imp_total_ars: 114_950 },
    ]);
  });
});
