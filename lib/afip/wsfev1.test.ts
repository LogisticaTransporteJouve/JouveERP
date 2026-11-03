import { describe, expect, it } from "vitest";

import {
  CBTE_TIPO,
  CONCEPTO,
  CONDICION_IVA_RECEPTOR,
  DOC_TIPO,
  IVA_RATE,
  MONEDA,
} from "./codes";
import {
  __test_parsers__,
  normalizeSalesPoints,
  type InvoiceRequestInput,
} from "./wsfev1";

const { buildFECAEDetRequest, toAfipDate, fmtMoney, parseObservations } =
  __test_parsers__;

describe("normalizeSalesPoints", () => {
  it("returns empty array for undefined", () => {
    expect(normalizeSalesPoints(undefined)).toEqual([]);
  });

  it("wraps a single PtoVenta object into an array", () => {
    const result = normalizeSalesPoints({
      Nro: 1,
      EmisionTipo: "CAE",
      Bloqueado: "N",
      FchBaja: "NULL",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      number: 1,
      emissionType: "CAE",
      blocked: false,
      expirationDate: null,
    });
  });

  it("flags blocked sales points", () => {
    const [pos] = normalizeSalesPoints({
      Nro: 99,
      EmisionTipo: "CAE",
      Bloqueado: "S",
      FchBaja: "NULL",
    });
    expect(pos?.blocked).toBe(true);
  });

  it("preserves expirationDate when not NULL", () => {
    const [pos] = normalizeSalesPoints({
      Nro: 5,
      EmisionTipo: "CAEA",
      Bloqueado: "N",
      FchBaja: "20251231",
    });
    expect(pos?.expirationDate).toBe("20251231");
  });

  it("normalizes a list of PtoVenta entries", () => {
    const result = normalizeSalesPoints([
      { Nro: 1, EmisionTipo: "CAE", Bloqueado: "N", FchBaja: "NULL" },
      { Nro: 2, EmisionTipo: "CAEA", Bloqueado: "S", FchBaja: "NULL" },
    ]);
    expect(result.map((p) => p.number)).toEqual([1, 2]);
    expect(result.map((p) => p.blocked)).toEqual([false, true]);
  });

  it("falls back to UNKNOWN when EmisionTipo missing", () => {
    const [pos] = normalizeSalesPoints({ Nro: 1 });
    expect(pos?.emissionType).toBe("UNKNOWN");
    expect(pos?.blocked).toBe(false);
  });
});

describe("toAfipDate", () => {
  it("strips dashes from ISO date", () => {
    expect(toAfipDate("2026-05-09")).toBe("20260509");
  });
});

describe("fmtMoney", () => {
  it("forces two decimals", () => {
    expect(fmtMoney(100)).toBe("100.00");
    expect(fmtMoney(0.1)).toBe("0.10");
    expect(fmtMoney(1.005)).toBe("1.00"); // bankers' rounding edge: documenting
  });
});

describe("parseObservations", () => {
  it("returns empty array when no Obs node", () => {
    expect(parseObservations(undefined)).toEqual([]);
  });

  it("wraps a single Obs object", () => {
    const obs = parseObservations({
      Obs: { Code: 10063, Msg: "Detail mismatch" },
    });
    expect(obs).toEqual([{ code: 10063, message: "Detail mismatch" }]);
  });

  it("normalizes a list of Obs entries", () => {
    const obs = parseObservations({
      Obs: [
        { Code: 1, Msg: "first" },
        { Code: 2, Msg: "second" },
      ],
    });
    expect(obs).toHaveLength(2);
    expect(obs[1]?.code).toBe(2);
  });
});

describe("buildFECAEDetRequest", () => {
  const baseInput: InvoiceRequestInput = {
    ptoVta: 3,
    cbteTipo: CBTE_TIPO.FACTURA_B,
    cbteNro: 124,
    fecha: "2026-05-09",
    concepto: CONCEPTO.SERVICIOS,
    docTipo: DOC_TIPO.CUIT,
    docNro: "30714637432",
    impTotal: 121,
    impNeto: 100,
    impIva: 21,
    impTotConc: 0,
    impOpEx: 0,
    impTrib: 0,
    monId: MONEDA.PESOS,
    monCotiz: 1,
    condicionIvaReceptorId: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
    iva: [
      { id: IVA_RATE.TWENTY_ONE, baseImp: 100, importe: 21 },
    ],
  };

  it("emits required fields in AFIP order", () => {
    const xml = buildFECAEDetRequest(baseInput);
    const idx = (tag: string) => xml.indexOf(`<fe:${tag}>`);
    expect(idx("Concepto")).toBeGreaterThan(-1);
    // Order matters for AFIP's XSD: Concepto, DocTipo, DocNro, CbteDesde,
    // CbteHasta, CbteFch, ImpTotal, ImpTotConc, ImpNeto, ImpOpEx, ImpTrib,
    // ImpIVA, MonId, MonCotiz, CondicionIVAReceptorId, Iva.
    expect(idx("Concepto")).toBeLessThan(idx("DocTipo"));
    expect(idx("DocTipo")).toBeLessThan(idx("CbteFch"));
    expect(idx("ImpTotal")).toBeLessThan(idx("ImpTotConc"));
    expect(idx("ImpTotConc")).toBeLessThan(idx("ImpNeto"));
    expect(idx("ImpNeto")).toBeLessThan(idx("ImpIVA"));
    expect(idx("ImpIVA")).toBeLessThan(idx("MonId"));
    expect(idx("MonCotiz")).toBeLessThan(idx("CondicionIVAReceptorId"));
    expect(idx("CondicionIVAReceptorId")).toBeLessThan(idx("Iva"));
  });

  it("formats money to 2 decimals", () => {
    const xml = buildFECAEDetRequest(baseInput);
    expect(xml).toContain("<fe:ImpTotal>121.00</fe:ImpTotal>");
    expect(xml).toContain("<fe:ImpNeto>100.00</fe:ImpNeto>");
    expect(xml).toContain("<fe:ImpIVA>21.00</fe:ImpIVA>");
  });

  it("converts ISO dates to YYYYMMDD", () => {
    const xml = buildFECAEDetRequest(baseInput);
    expect(xml).toContain("<fe:CbteFch>20260509</fe:CbteFch>");
  });

  it("includes service-period fields when present", () => {
    const xml = buildFECAEDetRequest({
      ...baseInput,
      fchServDesde: "2026-05-01",
      fchServHasta: "2026-05-31",
      fchVtoPago: "2026-06-15",
    });
    expect(xml).toContain("<fe:FchServDesde>20260501</fe:FchServDesde>");
    expect(xml).toContain("<fe:FchServHasta>20260531</fe:FchServHasta>");
    expect(xml).toContain("<fe:FchVtoPago>20260615</fe:FchVtoPago>");
  });

  it("omits service-period fields when null/undefined", () => {
    const xml = buildFECAEDetRequest({
      ...baseInput,
      fchServDesde: null,
      fchServHasta: null,
      fchVtoPago: null,
    });
    expect(xml).not.toContain("FchServDesde");
    expect(xml).not.toContain("FchServHasta");
    expect(xml).not.toContain("FchVtoPago");
  });

  it("emits Iva block with each alícuota entry", () => {
    const xml = buildFECAEDetRequest({
      ...baseInput,
      iva: [
        { id: IVA_RATE.TWENTY_ONE, baseImp: 100, importe: 21 },
        { id: IVA_RATE.TEN_FIVE, baseImp: 200, importe: 21 },
      ],
    });
    expect(xml).toContain("<fe:Iva>");
    expect(xml).toContain(
      `<fe:Id>${IVA_RATE.TWENTY_ONE}</fe:Id>`,
    );
    expect(xml).toContain(
      `<fe:Id>${IVA_RATE.TEN_FIVE}</fe:Id>`,
    );
    expect(xml).toContain("<fe:BaseImp>100.00</fe:BaseImp>");
    expect(xml).toContain("<fe:Importe>21.00</fe:Importe>");
  });

  it("omits Iva block when no entries", () => {
    const xml = buildFECAEDetRequest({ ...baseInput, iva: [] });
    expect(xml).not.toContain("<fe:Iva>");
  });

  it("emits CbtesAsoc when provided (NC/ND case)", () => {
    const xml = buildFECAEDetRequest({
      ...baseInput,
      cbtesAsoc: [{ tipo: CBTE_TIPO.FACTURA_B, ptoVta: 3, nro: 100 }],
    });
    expect(xml).toContain("<fe:CbtesAsoc>");
    expect(xml).toContain(
      `<fe:Tipo>${CBTE_TIPO.FACTURA_B}</fe:Tipo>`,
    );
    expect(xml).toContain("<fe:Nro>100</fe:Nro>");
  });
});
