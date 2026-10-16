import { describe, expect, it } from "vitest";

import {
  CBTE_TIPO,
  CONDICION_IVA_RECEPTOR,
  IVA_RATE,
  cbteTipoFor,
  condicionIvaReceptorFor,
  isReceptorConditionValidForLetter,
  isServiciosConcepto,
  ivaRatePercent,
  letterFor,
} from "./codes";
import type { IvaCondition } from "@/features/clients/schema";

describe("cbteTipoFor", () => {
  it("maps factura by letter", () => {
    expect(cbteTipoFor("factura", "A")).toBe(CBTE_TIPO.FACTURA_A);
    expect(cbteTipoFor("factura", "B")).toBe(CBTE_TIPO.FACTURA_B);
    expect(cbteTipoFor("factura", "C")).toBe(CBTE_TIPO.FACTURA_C);
  });

  it("maps NC and ND by letter", () => {
    expect(cbteTipoFor("nc", "A")).toBe(CBTE_TIPO.NC_A);
    expect(cbteTipoFor("nc", "B")).toBe(CBTE_TIPO.NC_B);
    expect(cbteTipoFor("nc", "C")).toBe(CBTE_TIPO.NC_C);
    expect(cbteTipoFor("nd", "A")).toBe(CBTE_TIPO.ND_A);
    expect(cbteTipoFor("nd", "B")).toBe(CBTE_TIPO.ND_B);
    expect(cbteTipoFor("nd", "C")).toBe(CBTE_TIPO.ND_C);
  });
});

describe("letterFor", () => {
  it("returns A when receptor is responsable inscripto", () => {
    expect(letterFor("responsable_inscripto")).toBe("A");
  });

  it("returns A for monotributo (RG 5003)", () => {
    expect(letterFor("monotributo")).toBe("A");
  });

  it("returns B for everyone else (single-CUIT, emisor RI)", () => {
    expect(letterFor("exento")).toBe("B");
    expect(letterFor("consumidor_final")).toBe("B");
    expect(letterFor("no_categorizado")).toBe("B");
  });
});

describe("condicionIvaReceptorFor", () => {
  it("maps every internal IVA condition to an AFIP code", () => {
    expect(condicionIvaReceptorFor("responsable_inscripto")).toBe(
      CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
    );
    expect(condicionIvaReceptorFor("monotributo")).toBe(
      CONDICION_IVA_RECEPTOR.MONOTRIBUTO,
    );
    expect(condicionIvaReceptorFor("exento")).toBe(
      CONDICION_IVA_RECEPTOR.EXENTO,
    );
    expect(condicionIvaReceptorFor("consumidor_final")).toBe(
      CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    );
    expect(condicionIvaReceptorFor("no_categorizado")).toBe(
      CONDICION_IVA_RECEPTOR.NO_CATEGORIZADO,
    );
  });
});

describe("ivaRatePercent", () => {
  it("returns the percentage for each id", () => {
    expect(ivaRatePercent(IVA_RATE.ZERO)).toBe(0);
    expect(ivaRatePercent(IVA_RATE.TEN_FIVE)).toBe(10.5);
    expect(ivaRatePercent(IVA_RATE.TWENTY_ONE)).toBe(21);
    expect(ivaRatePercent(IVA_RATE.TWENTY_SEVEN)).toBe(27);
    expect(ivaRatePercent(IVA_RATE.FIVE)).toBe(5);
    expect(ivaRatePercent(IVA_RATE.TWO_FIVE)).toBe(2.5);
  });
});

describe("isServiciosConcepto", () => {
  it("identifies servicios and mixed", () => {
    expect(isServiciosConcepto(2)).toBe(true);
    expect(isServiciosConcepto(3)).toBe(true);
  });

  it("excludes pure productos", () => {
    expect(isServiciosConcepto(1)).toBe(false);
  });
});

describe("isReceptorConditionValidForLetter", () => {
  it("accepts the receptor condition of every letter letterFor picks", () => {
    const conditions: IvaCondition[] = [
      "responsable_inscripto",
      "monotributo",
      "exento",
      "consumidor_final",
      "no_categorizado",
    ];
    for (const c of conditions) {
      expect(
        isReceptorConditionValidForLetter(
          letterFor(c),
          condicionIvaReceptorFor(c),
        ),
      ).toBe(true);
    }
  });

  it("rejects a B voucher to a monotributista and an A voucher to a consumidor final", () => {
    expect(
      isReceptorConditionValidForLetter(
        "B",
        CONDICION_IVA_RECEPTOR.MONOTRIBUTO,
      ),
    ).toBe(false);
    expect(
      isReceptorConditionValidForLetter(
        "A",
        CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
      ),
    ).toBe(false);
    expect(
      isReceptorConditionValidForLetter(
        "B",
        CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
      ),
    ).toBe(false);
  });
});
