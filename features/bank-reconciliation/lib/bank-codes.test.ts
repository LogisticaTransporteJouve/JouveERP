import { describe, expect, it } from "vitest";

import type { BankStatementCode, StatementClient } from "../schema";
import { cuitsIn, findBankCode, proposeLine } from "./bank-codes";

function code(p: Partial<BankStatementCode>): BankStatementCode {
  return {
    id: "c",
    account_id: "a",
    bank_code: "2033",
    description_pattern: "",
    kind: "bank_fee",
    chart_account_id: "acc",
    chart_account_label: "5.4.2 Comisiones bancarias",
    label: "Comisión",
    ...p,
  };
}

const LIMPART: StatementClient = {
  id: "cl1",
  cuit: "30601677675",
  legal_name: "LIMPART SRL",
  display_name: null,
  iva_condition: "responsable_inscripto",
  is_fiscal: true,
};

describe("findBankCode", () => {
  it("prefers the code whose text the description contains", () => {
    const whole = code({ id: "whole" });
    const iva = code({ id: "iva", description_pattern: "iva basico" });
    expect(
      findBankCode(
        { bank_code: "2033", description: "  DEBITO FISCAL IVA BASICO" },
        [whole, iva],
      )?.id,
    ).toBe("iva");
    expect(
      findBankCode(
        { bank_code: "2033", description: "MANTENIMIENTO MENSUAL PAQUETE" },
        [whole, iva],
      )?.id,
    ).toBe("whole");
  });

  it("finds nothing without the line's code", () => {
    expect(
      findBankCode({ bank_code: null, description: "x" }, [code({})]),
    ).toBeNull();
  });
});

describe("cuitsIn", () => {
  it("reads the valid CUITs Macro writes in the description", () => {
    expect(cuitsIn("TEF DATANET PR LIMPART SRL        30601677675")).toEqual([
      "30601677675",
    ]);
    expect(cuitsIn("CREDIN:1LMP68NKK1153X3PNR7OEV-30601677675")).toEqual([
      "30601677675",
    ]);
    expect(cuitsIn("DBCR 25413 S/CR TASA GRAL")).toEqual([]);
  });
});

describe("proposeLine", () => {
  const byCuit = new Map([[LIMPART.cuit, LIMPART]]);

  it("a tax with its account is ready to accept", () => {
    const p = proposeLine(
      { bank_code: "1685", description: "DBCR 25413 S/CR", amount: -2007.04 },
      [code({ bank_code: "1685", kind: "tax", label: "Ley 25.413" })],
      byCuit,
    );
    expect(p.ready).toBe(true);
    expect(p.kind).toBe("tax");
  });

  it("a tax without account asks for it", () => {
    const p = proposeLine(
      { bank_code: "1685", description: "DBCR", amount: -1 },
      [
        code({
          bank_code: "1685",
          kind: "tax",
          chart_account_id: null,
          chart_account_label: null,
        }),
      ],
      byCuit,
    );
    expect(p.ready).toBe(false);
    expect(p.missing).toBe("Elegí la cuenta contable.");
  });

  it("a collection finds its client by the CUIT", () => {
    const p = proposeLine(
      {
        bank_code: "2027",
        description: "TEF DATANET PR LIMPART SRL 30601677675",
        amount: 352240,
      },
      [code({ bank_code: "2027", kind: "receipt", chart_account_id: null })],
      byCuit,
    );
    expect(p.client?.id).toBe("cl1");
    expect(p.label).toBe("Cobro de LIMPART SRL");
  });

  it("an unknown code asks to configure it", () => {
    const p = proposeLine(
      { bank_code: "9999", description: "OTRO", amount: -1 },
      [],
      byCuit,
    );
    expect(p.code).toBeNull();
    expect(p.label).toBe("Código 9999 sin configurar");
  });
});
