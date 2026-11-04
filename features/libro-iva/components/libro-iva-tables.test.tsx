// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibroIvaComprasRow, LibroIvaVentasRow } from "../schema";

const listVentas = vi.fn();
const listCompras = vi.fn();
const header = vi.fn();

vi.mock("../actions/libro-iva-actions", () => ({
  listLibroIvaVentasAction: () => listVentas(),
  listLibroIvaComprasAction: () => listCompras(),
  getLibroIvaHeaderAction: () => header(),
  exportLibroIvaTxtAction: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { LibroIvaVentasTable } = await import("./libro-iva-ventas-table");
const { LibroIvaComprasTable } = await import("./libro-iva-compras-table");

function renderWithQuery(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  listVentas.mockReset();
  listCompras.mockReset();
  header.mockReset();
});

// Invented CUITs and names only.
const venta = (over: Partial<LibroIvaVentasRow>): LibroIvaVentasRow => ({
  invoice_id: "v1",
  fecha: "2026-09-01",
  kind: "factura",
  letter: "A",
  punto_venta: 3,
  numero: 1,
  cbte_tipo_afip: 1,
  client_legal_name: "Cliente Uno S.A.",
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

const okHeader = {
  ok: true,
  data: {
    companyName: "Empresa Test S.A.",
    cuit: "30000000007",
    closed: false,
  },
};

describe("LibroIvaVentasTable", () => {
  it("shows the neto and IVA of an imported voucher without items, an NC negative, and only the period's alícuotas", async () => {
    listVentas.mockResolvedValue({
      ok: true,
      data: [
        venta({}),
        venta({
          invoice_id: "v2",
          numero: 2,
          kind: "nc",
          cbte_tipo_afip: 3,
          neto: 100,
          iva: 21,
          imp_total: 121,
        }),
      ],
    });
    header.mockResolvedValue(okHeader);
    renderWithQuery(<LibroIvaVentasTable period="2026-09" channelId={null} />);

    expect(
      await screen.findByText(
        "Libro de I.V.A. Ventas (01/09/2026 - 30/09/2026) - Previo",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Empresa Test S.A.")).toBeTruthy();
    expect(screen.getByText("C.U.I.T.: 30-00000000-7")).toBeTruthy();

    const table = screen.getByRole("table");
    expect(within(table).getByText("21%")).toBeTruthy();
    expect(within(table).queryByText("27%")).toBeNull();
    expect(within(table).queryByText("Sin alícuota")).toBeNull();

    const [, , factura, nc, totals] = within(table).getAllByRole("row");
    const cells = (row: HTMLElement | undefined) =>
      within(row!)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells(factura)).toEqual(
      expect.arrayContaining(["FC", "RI", "1.000,00", "210,00", "1.210,00"]),
    );
    expect(cells(nc)).toEqual(
      expect.arrayContaining(["NC", "-100,00", "-21,00", "-121,00"]),
    );
    // The totals tie to computeTotals: the NC subtracts.
    expect(cells(totals)).toEqual(
      expect.arrayContaining([
        "Totales (2 comprobantes)",
        "900,00",
        "189,00",
        "1.089,00",
      ]),
    );
    expect(screen.getByText(/sin ítems/)).toBeTruthy();
  });

  it("puts a voucher whose rate cannot be inferred under Sin alícuota", async () => {
    listVentas.mockResolvedValue({
      ok: true,
      data: [venta({ neto: 1000, iva: 150, imp_total: 1150 })],
    });
    header.mockResolvedValue(okHeader);
    renderWithQuery(<LibroIvaVentasTable period="2026-09" channelId={null} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Sin alícuota")).toBeTruthy();
    expect(within(table).getAllByText("150,00").length).toBe(2);
    expect(screen.getByText(/no cierra\(n\) con/)).toBeTruthy();
  });
});

const compra = (over: Partial<LibroIvaComprasRow>): LibroIvaComprasRow => ({
  purchase_invoice_id: "c1",
  fecha: "2026-09-02",
  kind: "factura",
  letter: "A",
  punto_venta: 840,
  numero: 10,
  supplier_legal_name: "Proveedor Peaje S.A.",
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

describe("LibroIvaComprasTable", () => {
  it("prints one perception line per type with its letter and says Definitivo for a closed period", async () => {
    listCompras.mockResolvedValue({ ok: true, data: [compra({})] });
    header.mockResolvedValue({
      ok: true,
      data: { ...okHeader.data, closed: true },
    });
    renderWithQuery(<LibroIvaComprasTable period="2026-09" channelId={null} />);
    expect(
      await screen.findByText(
        "Libro de I.V.A. Compras (01/09/2026 - 30/09/2026) - Definitivo",
      ),
    ).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("310,57 B")).toHaveLength(2);
    expect(within(table).getAllByText("532,41 I")).toHaveLength(2);
    expect(within(table).getByText("Imp. int.")).toBeTruthy();
    expect(within(table).queryByText("10.5%")).toBeNull();
  });

  it("prints a B purchase under «Sin discriminar (B/C)», not 0%", async () => {
    const noTrib = {
      imp_trib: 0,
      imp_trib_orig: 0,
      perc_iva: 0,
      perc_iibb: 0,
      perc_iva_orig: 0,
      perc_iibb_orig: 0,
    };
    listCompras.mockResolvedValue({
      ok: true,
      data: [
        compra({
          ...noTrib,
          letter: "B",
          iva_rate_id: null,
          has_items: false,
          neto: 1210,
          iva: 0,
          imp_total: 1210,
          neto_orig: 1210,
          iva_orig: 0,
          imp_total_orig: 1210,
        }),
      ],
    });
    header.mockResolvedValue(okHeader);
    renderWithQuery(<LibroIvaComprasTable period="2026-09" channelId={null} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Sin discriminar (B/C)")).toBeTruthy();
    expect(within(table).queryByText("0%")).toBeNull();
    expect(within(table).getByText("Importe")).toBeTruthy();
    expect(screen.getByText(/1 comprobante\(s\) B o C/)).toBeTruthy();
    expect(screen.queryByText(/sin ítems/)).toBeNull();
  });
});

describe("a failed book read", () => {
  it.each([
    ["ventas", LibroIvaVentasTable, listVentas, /No hay comprobantes/],
    ["compras", LibroIvaComprasTable, listCompras, /No hay compras/],
  ] as const)(
    "%s: shows the error with a retry, not an empty period, and no export",
    async (_book, Table, list, emptyCopy) => {
      list.mockResolvedValue({
        ok: false,
        error: "No se pudo leer el libro IVA del período.",
      });
      header.mockResolvedValue(okHeader);
      renderWithQuery(<Table period="2026-09" channelId={null} />);
      expect(
        await screen.findByText("No se pudo leer el libro IVA del período."),
      ).toBeTruthy();
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Reintentar/ })).toBeTruthy();
      expect(screen.queryByText(emptyCopy)).toBeNull();
      expect(screen.queryByText("Exportar PDF")).toBeNull();
      expect(screen.queryByText("Exportar Excel")).toBeNull();
      expect(
        screen.getByText(/Exportar PDF y Excel no está disponible/),
      ).toBeTruthy();
    },
  );
});
