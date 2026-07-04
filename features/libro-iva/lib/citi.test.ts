import { describe, expect, it } from "vitest";

import type {
  LibroIvaComprasGroupedRow,
  LibroIvaVentasGroupedRow,
} from "../schema";

import { buildComprasTxt, buildVentasTxt } from "./citi";

function ventaDoc(
  overrides: Partial<LibroIvaVentasGroupedRow> = {},
): LibroIvaVentasGroupedRow {
  return {
    invoice_id: "inv-1",
    fecha: "2026-06-15",
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 123,
    cbte_tipo_afip: 1,
    client_legal_name: "Ñandú S.A.",
    doc_tipo: 80,
    doc_nro: "30-12345678-9",
    cae: null,
    cae_vencimiento: null,
    imp_trib: 0,
    imp_op_ex: 0,
    imp_tot_conc: 0,
    imp_total: 1210,
    channel_name: "Fiscal",
    channel_id: "jouve_fiscal",
    has_items: true,
    per_rate: { 5: { neto: 1000, iva: 210 } },
    ...overrides,
  };
}

function compraDoc(
  overrides: Partial<LibroIvaComprasGroupedRow> = {},
): LibroIvaComprasGroupedRow {
  return {
    purchase_invoice_id: "pi-1",
    fecha: "2026-06-20",
    kind: "factura",
    letter: "A",
    punto_venta: 12,
    numero: 4567,
    supplier_legal_name: "Proveedor SRL",
    supplier_cuit: "30-98765432-1",
    cae_proveedor: null,
    cae_vto_proveedor: null,
    imp_trib: 50,
    imp_total: 1260,
    channel_name: "Fiscal",
    channel_id: "jouve_fiscal",
    has_items: true,
    per_rate: { 5: { neto: 1000, iva: 210 } },
    ...overrides,
  };
}

const NO_EXTRAS = new Map();

describe("buildVentasTxt", () => {
  it("emits a 266-char cbte line and a 62-char alícuota line", () => {
    const r = buildVentasTxt([ventaDoc()], NO_EXTRAS, "2026-06");
    const [cbteFile, alicFile] = r.files;
    const cbte = cbteFile!.content.split("\r\n")[0]!;
    const alic = alicFile!.content.split("\r\n")[0]!;

    expect(cbte).toHaveLength(266);
    expect(alic).toHaveLength(62);
    expect(r.documents).toBe(1);
    expect(r.warnings).toHaveLength(0);

    expect(cbte.slice(0, 8)).toBe("20260615"); // fecha
    expect(cbte.slice(8, 11)).toBe("001"); // tipo
    expect(cbte.slice(11, 16)).toBe("00003"); // punto de venta
    expect(cbte.slice(16, 36)).toBe("123".padStart(20, "0")); // nro
    expect(cbte.slice(36, 56)).toBe("123".padStart(20, "0")); // nro hasta
    expect(cbte.slice(56, 58)).toBe("80"); // cod doc
    expect(cbte.slice(58, 78)).toBe("30123456789".padStart(20, "0"));
    expect(cbte.slice(78, 108)).toBe("NANDU S.A.".padEnd(30, " "));
    expect(cbte.slice(108, 123)).toBe("000000000121000"); // total 1210.00
    expect(cbte.slice(228, 231)).toBe("PES");
    expect(cbte.slice(231, 241)).toBe("0001000000"); // TC 1.000000
    expect(cbte.slice(241, 242)).toBe("1"); // cant alícuotas
    expect(cbte.slice(242, 243)).toBe("0"); // cod operación
    expect(cbte.slice(258, 266)).toBe("00000000"); // fch vto pago

    expect(alic.slice(0, 3)).toBe("001");
    expect(alic.slice(3, 8)).toBe("00003");
    expect(alic.slice(28, 43)).toBe("000000000100000"); // neto 1000.00
    expect(alic.slice(43, 47)).toBe("0005"); // 21%
    expect(alic.slice(47, 62)).toBe("000000000021000"); // iva 210.00
  });

  it("uses the document exchange rate for USD invoices", () => {
    const extras = new Map([["inv-1", { moneda: "DOL", cotizacion: 1234.5 }]]);
    const r = buildVentasTxt([ventaDoc()], extras, "2026-06");
    const cbte = r.files[0]!.content.split("\r\n")[0]!;
    expect(cbte.slice(228, 231)).toBe("DOL");
    expect(cbte.slice(231, 241)).toBe("1234500000"); // 1234.500000
  });

  it("infers the alícuota from amounts when there's no breakdown", () => {
    const r = buildVentasTxt(
      [ventaDoc({ per_rate: { [-1]: { neto: 1000, iva: 105 } } })],
      NO_EXTRAS,
      "2026-06",
    );
    const alic = r.files[1]!.content.split("\r\n")[0]!;
    expect(alic.slice(43, 47)).toBe("0004"); // 10.5%
  });

  it("excludes documents without an AFIP voucher type and reports it", () => {
    const r = buildVentasTxt(
      [ventaDoc({ cbte_tipo_afip: null })],
      NO_EXTRAS,
      "2026-06",
    );
    expect(r.documents).toBe(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.files[0]!.content).toBe("");
  });

  it("names files after the period", () => {
    const r = buildVentasTxt([], NO_EXTRAS, "2026-06");
    expect(r.files.map((f) => f.name)).toEqual([
      "LIBRO_IVA_DIGITAL_VENTAS_CBTE_202606.txt",
      "LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_202606.txt",
    ]);
  });
});

describe("buildComprasTxt", () => {
  it("emits a 325-char cbte line and an 84-char alícuota line for letter A", () => {
    const r = buildComprasTxt([compraDoc()], NO_EXTRAS, "2026-06");
    const cbte = r.files[0]!.content.split("\r\n")[0]!;
    const alic = r.files[1]!.content.split("\r\n")[0]!;

    expect(cbte).toHaveLength(325);
    expect(alic).toHaveLength(84);

    expect(cbte.slice(0, 8)).toBe("20260620");
    expect(cbte.slice(8, 11)).toBe("001"); // factura A
    expect(cbte.slice(36, 52)).toBe("0".repeat(16)); // despacho
    expect(cbte.slice(52, 54)).toBe("80");
    expect(cbte.slice(54, 74)).toBe("30987654321".padStart(20, "0"));
    expect(cbte.slice(104, 119)).toBe("000000000126000"); // total 1260.00
    expect(cbte.slice(237, 238)).toBe("1"); // cant alícuotas
    expect(cbte.slice(239, 254)).toBe("000000000021000"); // crédito fiscal 210.00
    expect(cbte.slice(254, 269)).toBe("000000000005000"); // otros tributos 50.00
    expect(cbte.slice(269, 280)).toBe("0".repeat(11)); // CUIT emisor
    expect(cbte.slice(310, 325)).toBe("0".repeat(15)); // IVA comisión

    expect(alic.slice(28, 30)).toBe("80");
    expect(alic.slice(30, 50)).toBe("30987654321".padStart(20, "0"));
    expect(alic.slice(65, 69)).toBe("0005");
  });

  it("reports B vouchers with zero alícuotas and no alícuota record", () => {
    const r = buildComprasTxt(
      [compraDoc({ letter: "B", kind: "factura", per_rate: {} })],
      NO_EXTRAS,
      "2026-06",
    );
    const cbte = r.files[0]!.content.split("\r\n")[0]!;
    expect(cbte.slice(8, 11)).toBe("006"); // factura B
    expect(cbte.slice(237, 238)).toBe("0");
    expect(cbte.slice(239, 254)).toBe("0".repeat(15)); // sin crédito fiscal
    expect(r.files[1]!.content).toBe("");
  });

  it("maps NC/ND kinds to their voucher codes", () => {
    const r = buildComprasTxt(
      [compraDoc({ kind: "nc", letter: "A" })],
      NO_EXTRAS,
      "2026-06",
    );
    expect(r.files[0]!.content.slice(8, 11)).toBe("003");
  });

  it("excludes purchases without letter or CUIT, reporting each", () => {
    const r = buildComprasTxt(
      [
        compraDoc({ letter: null }),
        compraDoc({ supplier_cuit: null, numero: 99 }),
      ],
      NO_EXTRAS,
      "2026-06",
    );
    expect(r.documents).toBe(0);
    expect(r.warnings).toHaveLength(2);
  });
});
