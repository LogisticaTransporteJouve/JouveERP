import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseReceivedResults } = await import("./results-json");

// Synthetic, in the shape of ajax.do?f=listaResultados (52 cells per row).
function row(cells: Record<number, string>): (string | null)[] {
  const r: (string | null)[] = Array.from({ length: 52 }, () => null);
  for (const [i, v] of Object.entries(cells)) r[Number(i)] = v;
  return r;
}

const base = {
  0: "01/11/2026",
  3: "3",
  8: "86439009998337",
  10: "80",
  11: "30711111118",
  12: "Proveedor SA",
  16: "1",
  17: "$",
};

describe("parseReceivedResults", () => {
  it("reads an A with IVA 21% and otros tributos, and a C with only the total", () => {
    const out = parseReceivedResults({
      estado: "ok",
      recordsTotal: 2,
      datos: {
        consulta: { cantidadResultados: 2 },
        data: [
          row({
            ...base,
            1: "1",
            4: "120",
            5: "120",
            32: "210.5",
            34: "1002.38",
            40: "1002.38",
            42: "0",
            44: "0",
            46: "30",
            48: "210.5",
            50: "1242.88",
          }),
          row({
            ...base,
            1: "11",
            4: "121",
            5: "121",
            42: "0",
            44: "0",
            50: "95000",
          }),
        ],
      },
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.skippedByReason).toEqual({});
    expect(out.vouchers).toMatchObject([
      {
        issuer_cuit: "30711111118",
        issuer_name: "Proveedor SA",
        letter: "A",
        punto_venta: 3,
        numero: 120,
        fecha: "2026-11-01",
        cae: "86439009998337",
        moneda: "PES",
        imp_neto_gravado: 1002.38,
        imp_iva: 210.5,
        imp_trib: 30,
        imp_total: 1242.88,
        iva_breakdown: [{ iva_rate_id: 5, neto: 1002.38, iva: 210.5 }],
      },
      { letter: "C", numero: 121, imp_neto_gravado: 95000, imp_total: 95000 },
    ]);
  });

  it("refuses an answer it does not recognise", () => {
    expect(parseReceivedResults({ estado: "error", datos: null })).toMatch(
      /formato que no se reconoce/,
    );
    expect(
      parseReceivedResults({ estado: "ok", datos: { data: [["01/11/2026"]] } }),
    ).toMatch(/formato que no se reconoce/);
  });
});
