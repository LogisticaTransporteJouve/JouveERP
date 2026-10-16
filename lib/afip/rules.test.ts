import { describe, expect, it } from "vitest";

import { CONCEPTO, CONDICION_IVA_RECEPTOR, DOC_TIPO, MONEDA } from "./codes";
import { fiscalVoucherIssue, type FiscalVoucherDraft } from "./rules";

const TODAY = "2026-10-16";

const base: FiscalVoucherDraft = {
  kind: "factura",
  letter: "A",
  receptor: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
  docTipo: DOC_TIPO.CUIT,
  docNro: "30712345678",
  concepto: CONCEPTO.SERVICIOS,
  fecha: TODAY,
  fchServDesde: TODAY,
  fchServHasta: TODAY,
  fchVtoPago: TODAY,
  moneda: MONEDA.PESOS,
  cotizacion: 1,
  origin: null,
};

describe("fiscalVoucherIssue", () => {
  it("accepts a well-formed factura A de servicios", () => {
    expect(fiscalVoucherIssue(base, TODAY)).toBeNull();
  });

  it("rejects a letter the receptor condition does not admit", () => {
    expect(
      fiscalVoucherIssue(
        { ...base, letter: "B", receptor: CONDICION_IVA_RECEPTOR.MONOTRIBUTO },
        TODAY,
      ),
    ).toMatch(/no admite comprobantes B/);
  });

  it("requires a CUIT on an A voucher", () => {
    expect(
      fiscalVoucherIssue({ ...base, docTipo: DOC_TIPO.DNI }, TODAY),
    ).toMatch(/CUIT/);
  });

  it("rejects a malformed CUIT", () => {
    expect(
      fiscalVoucherIssue({ ...base, docNro: "30-71234567-8" }, TODAY),
    ).toMatch(/11 dígitos/);
  });

  it("keeps an NC on its origin's letter and currency", () => {
    expect(
      fiscalVoucherIssue(
        { ...base, kind: "nc", origin: { letter: "B", moneda: MONEDA.PESOS } },
        TODAY,
      ),
    ).toMatch(/misma letra/);
    expect(
      fiscalVoucherIssue(
        {
          ...base,
          kind: "nc",
          origin: { letter: "A", moneda: MONEDA.DOLARES },
        },
        TODAY,
      ),
    ).toMatch(/misma moneda/);
    expect(
      fiscalVoucherIssue(
        { ...base, kind: "nc", origin: { letter: "A", moneda: MONEDA.PESOS } },
        TODAY,
      ),
    ).toBeNull();
  });

  it("enforces the CbteFch window: ±5 days for productos, ±10 for servicios", () => {
    const productos = {
      ...base,
      concepto: CONCEPTO.PRODUCTOS,
      fchServDesde: null,
      fchServHasta: null,
      fchVtoPago: null,
    };
    expect(
      fiscalVoucherIssue({ ...productos, fecha: "2026-10-11" }, TODAY),
    ).toBeNull();
    expect(
      fiscalVoucherIssue({ ...productos, fecha: "2026-10-10" }, TODAY),
    ).toMatch(/5 días/);
    expect(
      fiscalVoucherIssue(
        {
          ...base,
          fecha: "2026-10-06",
          fchServDesde: "2026-10-06",
          fchServHasta: "2026-10-06",
          fchVtoPago: "2026-10-06",
        },
        TODAY,
      ),
    ).toBeNull();
    expect(
      fiscalVoucherIssue(
        {
          ...base,
          fecha: "2026-10-27",
          fchServDesde: "2026-10-27",
          fchServHasta: "2026-10-27",
          fchVtoPago: "2026-10-27",
        },
        TODAY,
      ),
    ).toMatch(/10 días/);
  });

  it("requires ordered service dates and a vencimiento not before the voucher", () => {
    expect(fiscalVoucherIssue({ ...base, fchVtoPago: null }, TODAY)).toMatch(
      /fechas de servicio/,
    );
    expect(
      fiscalVoucherIssue(
        { ...base, fchServDesde: "2026-10-16", fchServHasta: "2026-10-10" },
        TODAY,
      ),
    ).toMatch(/desde no puede ser posterior/);
    expect(
      fiscalVoucherIssue({ ...base, fchVtoPago: "2026-10-15" }, TODAY),
    ).toMatch(/vencimiento de pago/);
  });

  it("ties the cotización to the currency", () => {
    expect(fiscalVoucherIssue({ ...base, cotizacion: 1050 }, TODAY)).toMatch(
      /pesos lleva cotización 1/,
    );
    expect(
      fiscalVoucherIssue(
        { ...base, moneda: MONEDA.DOLARES, cotizacion: 1 },
        TODAY,
      ),
    ).toMatch(/cotización del dólar/);
    expect(
      fiscalVoucherIssue(
        { ...base, moneda: MONEDA.DOLARES, cotizacion: 1050.5 },
        TODAY,
      ),
    ).toBeNull();
  });
});
