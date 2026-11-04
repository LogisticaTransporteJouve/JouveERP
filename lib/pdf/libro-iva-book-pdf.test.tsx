import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";

import { comprasBook, ventasBook } from "@/features/libro-iva/lib/book-layout";
import type {
  LibroIvaComprasRow,
  LibroIvaVentasRow,
} from "@/features/libro-iva/schema";

import { CONTENT_WIDTH, planLibroIvaPdf } from "./libro-iva-book-pdf";
import {
  LibroIvaComprasDocument,
  libroIvaComprasPlan,
} from "./libro-iva-compras-template";
import {
  LibroIvaVentasDocument,
  libroIvaVentasPlan,
} from "./libro-iva-ventas-template";

// Invented CUITs and names only.
const venta = (
  i: number,
  over: Partial<LibroIvaVentasRow> = {},
): LibroIvaVentasRow => ({
  invoice_id: `v${i}`,
  fecha: "2026-09-01",
  kind: "factura",
  letter: "A",
  punto_venta: 3,
  numero: 21000 + i,
  cbte_tipo_afip: 1,
  client_legal_name: `Cliente de prueba número ${i} Sociedad Anónima`,
  doc_tipo: 80,
  doc_nro: "30000000007",
  ci: "RI",
  cae: "70000000000000",
  cae_vencimiento: null,
  iva_rate_id: null,
  iva_rate_pct: null,
  neto: 1000,
  iva: 210,
  imp_trib: 0,
  imp_op_ex: 0,
  imp_tot_conc: 0,
  imp_total: 1210,
  channel_id: "jouve_fiscal",
  channel_name: "Jouve fiscal",
  has_items: false,
  moneda: "PES",
  cotizacion: 1,
  neto_orig: over.neto ?? 1000,
  iva_orig: over.iva ?? 210,
  imp_trib_orig: 0,
  imp_op_ex_orig: 0,
  imp_tot_conc_orig: 0,
  imp_total_orig: over.imp_total ?? 1210,
  ...over,
});

const compra = (
  i: number,
  over: Partial<LibroIvaComprasRow> = {},
): LibroIvaComprasRow => ({
  purchase_invoice_id: `c${i}`,
  fecha: "2026-09-01",
  kind: "factura",
  letter: "A",
  punto_venta: 840,
  numero: 686900 + i,
  supplier_legal_name: `Proveedor de prueba ${i} S.R.L.`,
  supplier_cuit: "30000000007",
  ci: "RI",
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

const header = {
  companyName: "Empresa Test S.A.",
  cuit: "30000000007",
  closed: false,
};

/** Pages of a rendered PDF (page objects, not the page tree). */
function pageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
}

const ventas = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    venta(i, i % 10 === 9 ? { kind: "nc", cbte_tipo_afip: 3 } : {}),
  );

describe("libro IVA PDF layout", () => {
  it("fits A4 landscape even with every alícuota and large amounts", () => {
    const rates: [number, number][] = [
      [3, 0],
      [9, 2.5],
      [8, 5],
      [4, 10.5],
      [5, 21],
      [6, 27],
    ];
    const rows = rates.map(([id, pct], i) =>
      venta(i, {
        iva_rate_id: id,
        has_items: true,
        neto: 987654321.12,
        iva: (987654321.12 * pct) / 100,
        imp_total: 987654321.12 * (1 + pct / 100),
      }),
    );
    // And one header-only voucher whose ratio fits no rate.
    rows.push(venta(9, { neto: 1000, iva: 150, imp_total: 1150 }));
    const plan = planLibroIvaPdf(ventasBook(rows), []);
    const width = plan.columns.reduce((a, c) => a + c.width, 0);
    expect(width).toBeLessThanOrEqual(CONTENT_WIDTH + 0.001);
    expect(plan.columns.filter((c) => c.header === "Neto")).toHaveLength(7);
    expect(plan.columns.find((c) => c.ellipsis)!.width).toBeGreaterThan(0);
  });

  it("prints only the alícuotas of the period and a voucher without items under its rate", () => {
    const plan = planLibroIvaPdf(ventasBook(ventas(3)), []);
    expect(plan.columns.map((c) => c.header)).toEqual([
      "Fecha",
      "TC",
      "Comprobante",
      "Razón social",
      "C.U.I.T.",
      "C.I.",
      "Neto",
      "IVA",
      "No gravado",
      "Exento",
      "Percepciones",
      "Total",
      "CAE",
    ]);
    expect(plan.columns[6]!.group).toBe("21%");
    const first = plan.pages[0]!.rows[0]!.cells;
    expect(first.slice(0, 6)).toEqual([
      ["01/09/2026"],
      ["FC"],
      ["A0003-00021000"],
      ["Cliente de prueba número 0 Sociedad Anónima"],
      ["30-00000000-7"],
      ["RI"],
    ]);
    expect(first[6]).toEqual(["1.000,00"]);
    expect(first[7]).toEqual(["210,00"]);
  });

  it("closes each page with the running subtotal and the last with the totals", () => {
    const rows = ventas(150);
    const model = ventasBook(rows);
    const plan = planLibroIvaPdf(model, []);
    expect(plan.pages.length).toBeGreaterThan(2);
    let through = 0;
    plan.pages.forEach((page, p) => {
      through += page.rows.length;
      const last = p === plan.pages.length - 1;
      const totals = last ? model.totals : model.totalsOfFirst(through);
      expect(page.footer.cells[0]).toEqual([
        last ? "Totales (150 comprobantes)" : "Subtotales",
      ]);
      // Neto and IVA 21%, then Total: 9 facturas and 1 NC every 10 rows.
      const iva = totals.per_rate[5]!.iva;
      expect(page.footer.cells[2]).toEqual([
        new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2 }).format(
          iva,
        ),
      ]);
    });
    expect(through).toBe(150);
    expect(model.totals.per_rate[5]!.iva).toBeCloseTo(210 * (135 - 15));
  });

  it("prints a credit note negative in every column", () => {
    const plan = planLibroIvaPdf(ventasBook(ventas(10)), []);
    const nc = plan.pages[0]!.rows[9]!.cells;
    expect(nc[1]).toEqual(["NC"]);
    expect(nc[6]).toEqual(["-1.000,00"]);
    expect(nc[7]).toEqual(["-210,00"]);
    expect(nc[11]).toEqual(["-1.210,00"]);
  });

  it("lists each perception on its own line with its letter", () => {
    const plan = planLibroIvaPdf(
      comprasBook([compra(1), compra(2, { kind: "nc" })]),
      [],
    );
    const headers = plan.columns.map((c) => c.header);
    const col = headers.indexOf("Percepciones");
    expect(headers).toContain("Imp. int.");
    expect(plan.pages[0]!.rows[0]!.cells[col]).toEqual([
      "310,57 B",
      "532,41 I",
    ]);
    expect(plan.pages[0]!.rows[1]!.cells[col]).toEqual([
      "-310,57 B",
      "-532,41 I",
    ]);
    // Two lines: the row is taller than a one-line row.
    expect(plan.pages[0]!.rows[0]!.height).toBeGreaterThan(plan.fontSize * 2);
  });
});

describe("libro IVA PDF render", () => {
  it("renders ventas on the pages the plan expects", async () => {
    const rows = ventas(150);
    const { plan } = libroIvaVentasPlan(rows);
    const pdf = await renderToBuffer(
      <LibroIvaVentasDocument
        period="2026-09"
        channelName="Jouve fiscal"
        generatedAt="1 oct 2026 10:00"
        header={header}
        rows={rows}
      />,
    );
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(plan.pages.length).toBeGreaterThan(2);
    expect(pageCount(pdf)).toBe(plan.pages.length);
  }, 30_000);

  it("renders compras with multi-line perceptions without spilling pages", async () => {
    const rows = Array.from({ length: 90 }, (_, i) =>
      compra(i, i % 3 === 0 ? { perc_nacionales: 10, imp_trib: 852.98 } : {}),
    );
    const pdf = await renderToBuffer(
      <LibroIvaComprasDocument
        period="2026-09"
        channelName="Jouve fiscal"
        generatedAt="1 oct 2026 10:00"
        header={{ ...header, closed: true }}
        rows={rows}
      />,
    );
    const { plan } = libroIvaComprasPlan(rows);
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(pageCount(pdf)).toBe(plan.pages.length);
  }, 30_000);
});
