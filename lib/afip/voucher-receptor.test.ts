import { describe, expect, it } from "vitest";

import { CONDICION_IVA_RECEPTOR, DOC_TIPO, voucherReceptor } from "./codes";

describe("voucherReceptor", () => {
  it("identifies a fiscal client by CUIT and its IVA condition", () => {
    expect(
      voucherReceptor({
        cuit: "30714637432",
        iva_condition: "responsable_inscripto",
      }),
    ).toEqual({
      doc_tipo: DOC_TIPO.CUIT,
      doc_nro: "30714637432",
      iva_condition_receptor: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
    });
  });

  it("maps a consumidor final with CUIT to the CF receptor condition", () => {
    expect(
      voucherReceptor({
        cuit: "20111111112",
        iva_condition: "consumidor_final",
      }).iva_condition_receptor,
    ).toBe(CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL);
  });

  it("an Otras ventas client (no CUIT, no IVA) is an unidentified receiver (doc 99, nro 0)", () => {
    expect(voucherReceptor({ cuit: null, iva_condition: null })).toEqual({
      doc_tipo: DOC_TIPO.CONSUMIDOR_FINAL,
      doc_nro: "0",
      iva_condition_receptor: null,
    });
  });

  it("never reports a CUIT receiver without both CUIT and IVA condition", () => {
    // The DB check (clients_side_identity) forbids these shapes; the helper
    // still must not emit doc 80 with a missing half.
    expect(
      voucherReceptor({ cuit: "30714637432", iva_condition: null }).doc_tipo,
    ).toBe(DOC_TIPO.CONSUMIDOR_FINAL);
    expect(
      voucherReceptor({ cuit: "", iva_condition: "monotributo" }).doc_tipo,
    ).toBe(DOC_TIPO.CONSUMIDOR_FINAL);
  });
});
