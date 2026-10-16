import { describe, expect, it } from "vitest";

import {
  IVA_RATES,
  computeComprasTotals,
  computeTotals,
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
