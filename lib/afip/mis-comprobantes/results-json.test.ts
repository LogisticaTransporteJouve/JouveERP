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

  it("reads ARCA's plain decimals one way: 12.345 is twelve, not twelve thousand", () => {
    const out = parseReceivedResults({
      estado: "ok",
      datos: {
        data: [
          row({
            ...base,
            1: "1",
            4: "130",
            5: "130",
            32: "21",
            34: "100",
            40: "100",
            42: "0",
            44: "0",
            46: "12.345",
            48: "21",
            50: "133.345",
          }),
        ],
      },
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.skippedByReason).toEqual({});
    expect(out.vouchers[0]).toMatchObject({
      imp_trib: 12.35,
      imp_total: 133.35,
    });
  });

  it("reads a voucher whose parts exceed its total by ARCA's rounding cent", () => {
    // tipo 1 05005-02251695 (22/06/2015): the parts add up to 3794,17.
    const out = parseReceivedResults({
      estado: "ok",
      datos: {
        data: [
          row({
            ...base,
            1: "1",
            4: "132",
            5: "132",
            40: "2832.19",
            42: "282.25",
            44: "0",
            46: "84.97",
            48: "594.76",
            50: "3794.16",
          }),
        ],
      },
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.skippedByReason).toEqual({});
    expect(out.vouchers[0]).toMatchObject({
      imp_neto_gravado: 2832.19,
      imp_total: 3794.16,
    });
  });

  it("names the amounts of a row whose parts exceed its total", () => {
    const out = parseReceivedResults({
      estado: "ok",
      datos: {
        data: [
          row({
            ...base,
            1: "1",
            4: "131",
            5: "131",
            40: "100",
            42: "-20",
            44: "0",
            48: "21",
            50: "101",
          }),
        ],
      },
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.skippedByReason).toEqual({ amount_over_total: 1 });
    // Its identity reads, so it is kept for the tray with what ARCA listed.
    expect(out.unreadable).toEqual([
      expect.objectContaining({
        issuer_cuit: "30711111118",
        cbte_tipo: 1,
        letter: "A",
        punto_venta: 3,
        numero: 131,
        fecha: "2026-11-01",
        unreadable_reason: "amount_over_total",
        raw_amounts: {
          neto: "100",
          no_gravado: "-20",
          exentas: "0",
          iva: "21",
          total: "101",
        },
      }),
    ]);
    expect(out.skipped[0]!.ref).toMatch(
      /00003-00000131 .*neto 100, no grav\. -20, exento 0, IVA 21, total 101$/,
    );
  });

  it("reads a bank's Liquidación A (63) and a Recibo C (15) as facturas of their letter", () => {
    const out = parseReceivedResults({
      estado: "ok",
      datos: {
        data: [
          row({
            ...base,
            1: "63",
            4: "140",
            5: "140",
            32: "21",
            34: "100",
            40: "100",
            42: "0",
            44: "0",
            48: "21",
            50: "121",
          }),
          row({
            ...base,
            1: "15",
            4: "141",
            5: "141",
            42: "0",
            44: "0",
            50: "500",
          }),
          row({
            ...base,
            1: "201",
            4: "142",
            5: "142",
            42: "0",
            44: "0",
            50: "500",
          }),
        ],
      },
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers.map((v) => [v.cbte_tipo, v.kind, v.letter])).toEqual([
      [63, "factura", "A"],
      [15, "factura", "C"],
      [201, null, null],
    ]);
  });

  it("reads a Factura M (51), ND M (52) and NC M (53) as letter A of their kind", () => {
    const amounts = {
      32: "21",
      34: "100",
      40: "100",
      42: "0",
      44: "0",
      48: "21",
      50: "121",
    };
    const out = parseReceivedResults({
      estado: "ok",
      datos: {
        data: [
          row({ ...base, ...amounts, 1: "51", 4: "150", 5: "150" }),
          row({ ...base, ...amounts, 1: "52", 4: "151", 5: "151" }),
          row({ ...base, ...amounts, 1: "53", 4: "152", 5: "152" }),
        ],
      },
    });
    if (typeof out === "string") throw new Error(out);
    expect(
      out.vouchers.map((v) => [v.cbte_tipo, v.kind, v.letter, v.imp_iva]),
    ).toEqual([
      [51, "factura", "A", 21],
      [52, "nd", "A", 21],
      [53, "nc", "A", 21],
    ]);
  });

  // PEISA ND A 00053-00000225 (2016) as «Traer de ARCA» gets it: the exento
  // is in «Neto Gravado Total», in «Op. Exentas» and as a 0% line.
  it("reads an exento repeated as a 0% line and in the neto as gravado + exento", () => {
    const out = parseReceivedResults({
      estado: "ok",
      datos: {
        data: [
          row({
            ...base,
            1: "2",
            4: "225",
            5: "225",
            18: "52122.9",
            32: "42",
            34: "200",
            40: "52322.9",
            42: "0",
            44: "52122.9",
            48: "42",
            50: "52364.9",
          }),
        ],
      },
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers).toHaveLength(1);
    expect(out.vouchers[0]).toMatchObject({
      kind: "nd",
      letter: "A",
      imp_neto_gravado: 200,
      imp_op_exentas: 52122.9,
      imp_iva: 42,
      imp_total: 52364.9,
      iva_breakdown: [{ iva_rate_id: 5, neto: 200, iva: 42 }],
    });
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
