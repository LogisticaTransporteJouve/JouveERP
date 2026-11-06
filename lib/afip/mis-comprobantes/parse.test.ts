import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseReceivedExport, parseReceivedTable } = await import("./parse");

// Synthetic, in the shape of ARCA → Mis Comprobantes → Recibidos (CSV, ";").
const HEADER =
  '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"IVA";"Imp. Total"';

function csv(...rows: string[]): Uint8Array {
  return new TextEncoder().encode([HEADER, ...rows].join("\r\n"));
}

describe("parseReceivedExport", () => {
  it("reads a factura A with exento and otros tributos", () => {
    const out = parseReceivedExport(
      "recibidos.csv",
      csv(
        '"10/09/2026";"1 - Factura A";"3";"120";"120";"76123456789012";"80";"30-71111111-8";"Proveedor SA";"1";"$";"1.000,00";"0,00";"50,00";"30,00";"210,00";"1.290,00"',
      ),
    );
    expect(out).toEqual({
      vouchers: [
        {
          issuer_cuit: "30711111118",
          issuer_name: "Proveedor SA",
          cbte_tipo: 1,
          kind: "factura",
          letter: "A",
          punto_venta: 3,
          numero: 120,
          fecha: "2026-09-10",
          cae: "76123456789012",
          moneda: "PES",
          cotizacion: null,
          imp_neto_gravado: 1000,
          imp_no_gravado: 0,
          imp_op_exentas: 50,
          imp_iva: 210,
          imp_trib: 30,
          imp_total: 1290,
          trib_breakdown: {},
          iva_breakdown: [],
        },
      ],
      unreadable: [],
      skippedByReason: {},
      skipped: [],
    });
  });

  it("reads an NC B in dollars, takes the absolute amounts and the rate", () => {
    const out = parseReceivedExport(
      "recibidos.csv",
      csv(
        '"2026-09-11";"8";"5";"7";"7";"";"80";"30711111118";"Proveedor SA";"1050,5";"DOL";"-100,00";"0";"0";"0";"0";"-100,00"',
      ),
    );
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers[0]).toMatchObject({
      kind: "nc",
      letter: "B",
      moneda: "DOL",
      cotizacion: 1050.5,
      imp_neto_gravado: 100,
      imp_total: 100,
    });
  });

  it("keeps a type the ERP does not model as unsupported (kind null)", () => {
    const out = parseReceivedExport(
      "recibidos.csv",
      csv(
        '"10/09/2026";"201 - Factura de Crédito Electrónica MiPyMEs (FCE) A";"3";"9";"9";"";"80";"30711111118";"Proveedor SA";"1";"$";"100";"0";"0";"0";"21";"121"',
      ),
    );
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers[0]).toMatchObject({
      cbte_tipo: 201,
      kind: null,
      letter: null,
    });
  });

  it("skips rows that do not read cleanly instead of reading them as 0", () => {
    const out = parseReceivedExport(
      "recibidos.csv",
      csv(
        '"31/02/2026";"1";"3";"1";"1";"";"80";"30711111118";"P";"1";"$";"100";"0";"0";"0";"21";"121"',
        '"10/09/2026";"1";"3";"2";"2";"";"80";"3071111";"P";"1";"$";"100";"0";"0";"0";"21";"121"',
        '"10/09/2026";"1";"3";"3";"3";"";"80";"30711111118";"P";"1";"$";"abc";"0";"0";"0";"21";"121"',
        '"10/09/2026";"1";"3";"4";"4";"";"80";"30711111118";"P";"1";"$";"100";"0";"0";"0";"21";"115"',
        '"10/09/2026";"1";"0";"5";"5";"";"80";"30711111118";"P";"1";"$";"100";"0";"0";"0";"21";"121"',
      ),
    );
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers).toEqual([]);
    expect(out.skippedByReason).toEqual({
      bad_date: 1,
      bad_cuit: 1,
      bad_amount: 1,
      amount_over_total: 1,
      bad_number: 1,
    });
  });

  // The owner's ARCA export (2014, Facturas A): totals above their parts,
  // read as ARCA lists them; the person accepting says where the gap goes.
  it("keeps a voucher whose total is above its parts, as ARCA lists it", () => {
    const out = parseReceivedExport(
      "recibidos.csv",
      csv(
        '"15/03/2014";"1 - Factura A";"2093";"3198905";"3198905";"";"80";"30639453738";"Telefónica Móviles Argentina SA";"1";"$";"895,00";"98,45";"0,00";"0,00";"241,65";"1.281,30"',
        '"15/04/2014";"1 - Factura A";"2093";"3338653";"3338653";"";"80";"30639453738";"Telefónica Móviles Argentina SA";"1";"$";"2110,42";"63,31";"0";"0";"564,83";"2.843,18"',
        '"02/05/2014";"1 - Factura A";"2";"1";"1";"";"80";"20111111112";"Retegui";"1";"$";"0,00";"0,00";"0,00";"0,00";"0,00";"57.934,80"',
        '"02/06/2014";"1 - Factura A";"2";"2";"2";"";"80";"20111111112";"Retegui";"1";"$";"0,00";"0,00";"0,00";"0,00";"0,00";"42.350,00"',
      ),
    );
    if (typeof out === "string") throw new Error(out);
    expect(out.skippedByReason).toEqual({});
    expect(
      out.vouchers.map((v) => [
        v.punto_venta,
        v.numero,
        v.imp_neto_gravado,
        v.imp_no_gravado,
        v.imp_op_exentas,
        v.imp_trib,
        v.imp_iva,
        v.imp_total,
      ]),
    ).toEqual([
      [2093, 3198905, 895, 98.45, 0, 0, 241.65, 1281.3],
      [2093, 3338653, 2110.42, 63.31, 0, 0, 564.83, 2843.18],
      [2, 1, 0, 0, 0, 0, 0, 57934.8],
      [2, 2, 0, 0, 0, 0, 0, 42350],
    ]);
  });

  it("reads a windows-1252 file", () => {
    const text = [
      HEADER,
      '"10/09/2026";"1";"3";"1";"1";"";"80";"30711111118";"Peña SA";"1";"$";"100";"0";"0";"0";"21";"121"',
    ].join("\n");
    const bytes = Uint8Array.from(
      [...text].map((ch) =>
        ch === "ñ"
          ? 0xf1
          : ch === "ó"
            ? 0xf3
            : ch === "é"
              ? 0xe9
              : ch === "ú"
                ? 0xfa
                : ch.charCodeAt(0),
      ),
    );
    const out = parseReceivedExport("recibidos.csv", bytes);
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers[0]?.issuer_name).toBe("Peña SA");
  });

  it("refuses a file it does not recognise", () => {
    expect(
      parseReceivedExport("x.csv", new TextEncoder().encode("a;b\n1;2")),
    ).toBe(
      "No se reconocen las columnas: subí el archivo de ARCA → Mis Comprobantes → Recibidos sin editar.",
    );
  });
});

describe("parseReceivedTable", () => {
  it("reads per-rate and per-tribute columns when the export has them", () => {
    const out = parseReceivedTable({
      truncated: false,
      rows: [
        [
          "Fecha de Emisión",
          "Tipo de Comprobante",
          "Punto de Venta",
          "Número Desde",
          "Nro. Doc. Emisor",
          "Denominación Emisor",
          "Moneda",
          "Imp. Neto Gravado IVA 21%",
          "IVA 21%",
          "Imp. Neto Gravado IVA 10,5%",
          "IVA 10,5%",
          "Imp. Neto Gravado",
          "IVA",
          "Otros Tributos",
          "Percepciones de IVA",
          "Percepciones de Ingresos Brutos",
          "Imp. Total",
        ],
        [
          "10/09/2026",
          "1",
          "3",
          "1",
          "30711111118",
          "P",
          "$",
          "100",
          "21",
          "200",
          "21",
          "300",
          "42",
          "5",
          "3",
          "2",
          "347",
        ],
      ],
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers[0]?.iva_breakdown).toEqual([
      { iva_rate_id: 5, neto: 100, iva: 21 },
      { iva_rate_id: 4, neto: 200, iva: 21 },
    ]);
    expect(out.vouchers[0]?.trib_breakdown).toEqual({
      perc_iva: 3,
      perc_iibb: 2,
    });
  });

  it("reads the old 30-column TSV by position", () => {
    const row = Array.from({ length: 30 }, () => "");
    row[0] = "10/09/2026";
    row[1] = "6";
    row[2] = "2";
    row[3] = "44";
    row[7] = "30711111118";
    row[8] = "P";
    row[12] = "$";
    row[24] = "100";
    row[29] = "100";
    const out = parseReceivedTable({ truncated: false, rows: [row] });
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers[0]).toMatchObject({
      kind: "factura",
      letter: "B",
      numero: 44,
      imp_total: 100,
    });
  });

  // The Excel export of today's Mis Comprobantes page (its 30 columns, as
  // DataTables writes them); synthetic values in the shape the page returns.
  it("reads the Excel export of the current page, C and NC C with only the total", () => {
    const header = [
      "Fecha",
      "Tipo",
      "Punto de Venta",
      "Número Desde",
      "Número Hasta",
      "Cód. Autorización",
      "Tipo Doc. Emisor",
      "Nro. Doc. Emisor",
      "Denominación Emisor",
      "Tipo Doc. Receptor",
      "Nro. Doc. Receptor",
      "Tipo Cambio",
      "Moneda",
      "Neto Grav. IVA 0%",
      "IVA 2,5%",
      "Neto Grav. IVA 2,5%",
      "IVA 5%",
      "Neto Grav. IVA 5%",
      "IVA 10,5%",
      "Neto Grav. IVA 10,5%",
      "IVA 21%",
      "Neto Grav. IVA 21%",
      "IVA 27%",
      "Neto Grav. IVA 27%",
      "Neto Gravado Total",
      "Neto No Gravado",
      "Op. Exentas",
      "Otros Tributos",
      "Total IVA",
      "Imp. Total",
    ];
    const row = (
      tipo: string,
      numero: string,
      amounts: Partial<Record<number, string>>,
      total: string,
    ) => {
      const r = [
        "01/11/2026",
        tipo,
        "3",
        numero,
        numero,
        "86439009998337",
        "CUIT",
        "30711111118",
        "Proveedor SA",
        "CUIT",
        "30722222229",
        "1",
        "$",
        ...Array.from({ length: 16 }, () => ""),
        total,
      ];
      for (const [i, v] of Object.entries(amounts)) r[Number(i)] = v!;
      return r;
    };
    const out = parseReceivedTable({
      truncated: false,
      rows: [
        header,
        row(
          "1 - Factura A",
          "120",
          {
            20: "210.5",
            21: "1002.38",
            24: "1002.38",
            25: "0",
            26: "0",
            27: "30",
            28: "210.5",
          },
          "1242.88",
        ),
        row("11 - Factura C", "121", { 25: "0", 26: "0" }, "95000"),
        row("13 - Nota de Crédito C", "7", {}, "95000"),
      ],
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.skippedByReason).toEqual({});
    expect(out.vouchers[0]).toMatchObject({
      letter: "A",
      moneda: "PES",
      cae: "86439009998337",
      imp_neto_gravado: 1002.38,
      imp_iva: 210.5,
      imp_trib: 30,
      imp_total: 1242.88,
      iva_breakdown: [{ iva_rate_id: 5, neto: 1002.38, iva: 210.5 }],
    });
    expect(out.vouchers[1]).toMatchObject({
      kind: "factura",
      letter: "C",
      imp_neto_gravado: 95000,
      imp_iva: 0,
      imp_total: 95000,
    });
    expect(out.vouchers[2]).toMatchObject({
      kind: "nc",
      letter: "C",
      imp_neto_gravado: 95000,
      imp_total: 95000,
    });
  });

  it("keeps an A that lists only the total and skips a detail that contradicts its subtotal", () => {
    const out = parseReceivedTable({
      truncated: false,
      rows: [
        [
          "Fecha",
          "Tipo",
          "Punto de Venta",
          "Número Desde",
          "Nro. Doc. Emisor",
          "Neto Grav. IVA 21%",
          "IVA 21%",
          "Neto Gravado Total",
          "Total IVA",
          "Imp. Total",
        ],
        ["01/11/2026", "1", "3", "1", "30711111118", "", "", "0", "0", "100"],
        // The 21 % line says 90 of net, the subtotal 100.
        [
          "01/11/2026",
          "1",
          "3",
          "2",
          "30711111118",
          "90",
          "21",
          "100",
          "21",
          "121",
        ],
      ],
    });
    if (typeof out === "string") throw new Error(out);
    expect(out.vouchers).toHaveLength(1);
    expect(out.vouchers[0]).toMatchObject({
      numero: 1,
      imp_neto_gravado: 0,
      imp_total: 100,
    });
    expect(out.skippedByReason).toEqual({ breakdown_mismatch: 1 });
    // Named as ARCA lists it, so a person can find it.
    expect(out.skipped).toEqual([
      {
        reason: "breakdown_mismatch",
        ref: "tipo 1 · 00003-00000002 · CUIT 30711111118 · 01/11/2026",
      },
    ]);
  });

  it("refuses more than 5000 vouchers", () => {
    expect(parseReceivedTable({ truncated: true, rows: [] })).toMatch(
      /más de 5000/,
    );
  });
});
