import { describe, expect, it } from "vitest";

import type { BankStatementCode, StatementClient } from "../schema";
import {
  PROVINCIA_CODES,
  findLoanInstallment,
  suggestLoanSplit,
  conceptOf,
  cuitsIn,
  findBankCode,
  proposeLine,
} from "./bank-codes";

const CUOTA_11 = {
  id: "i11",
  loan_description: "Préstamo a Sola Firma",
  number: 11,
  count: 12,
  due_date: "2026-11-03",
  amount: 1858377.66,
  capital: 1725520.13,
  iva: 12279.97,
};

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
      {
        bank_code: "1685",
        description: "DBCR 25413 S/CR",
        amount: -2007.04,
        line_date: "2026-11-03",
      },
      [code({ bank_code: "1685", kind: "tax", label: "Ley 25.413" })],
      byCuit,
    );
    expect(p.ready).toBe(true);
    expect(p.kind).toBe("tax");
  });

  it("a tax without account asks for it", () => {
    const p = proposeLine(
      {
        bank_code: "1685",
        description: "DBCR",
        amount: -1,
        line_date: "2026-11-03",
      },
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
        line_date: "2026-11-03",
      },
      [code({ bank_code: "2027", kind: "receipt", chart_account_id: null })],
      byCuit,
    );
    expect(p.client?.id).toBe("cl1");
    expect(p.label).toBe("Cobro de LIMPART SRL");
  });

  it("an unknown code asks to configure it", () => {
    const p = proposeLine(
      {
        bank_code: "9999",
        description: "OTRO",
        amount: -1,
        line_date: "2026-11-03",
      },
      [],
      byCuit,
    );
    expect(p.code).toBeNull();
    expect(p.label).toBe("Código 9999 sin configurar");
  });

  it("a loan debit pays the pending cuota of the same amount", () => {
    const p = proposeLine(
      {
        bank_code: "361",
        description: "DEBITO PRESTAMOS REC",
        amount: -1858377.66,
        line_date: "2026-11-03",
      },
      [code({ bank_code: "361", kind: "loan", chart_account_id: null })],
      byCuit,
      [
        CUOTA_11,
        {
          ...CUOTA_11,
          id: "i12",
          number: 12,
          due_date: "2026-12-03",
          amount: 1850555.27,
        },
      ],
    );
    expect(p.installment?.id).toBe("i11");
    expect(p.label).toBe("Cuota 11/12 — Préstamo a Sola Firma");
  });

  it("a loan debit with no cuota of that amount says so", () => {
    const p = proposeLine(
      {
        bank_code: "361",
        description: "DEBITO PRESTAMOS REC",
        amount: -100,
        line_date: "2026-11-03",
      },
      [code({ bank_code: "361", kind: "loan", chart_account_id: null })],
      byCuit,
      [CUOTA_11],
    );
    expect(p.installment).toBeNull();
    expect(p.missing).toContain("No hay una cuota pendiente");
  });
});

describe("a bank with no code (Provincia)", () => {
  const codes = PROVINCIA_CODES.map((c, i) =>
    code({
      id: `p${i}`,
      bank_code: c.bank_code,
      description_pattern: c.description_pattern,
      kind: c.kind,
      label: c.label,
    }),
  );
  const kindOf = (description: string) =>
    findBankCode({ bank_code: null, description }, codes)?.kind ?? null;

  it("reads each movement by its concept, in both exports", () => {
    expect(kindOf("IMPUESTO DEBITO - LEY 25413    0023")).toBe("tax");
    expect(kindOf("RETENCION ARBA                 6401 SUIPACHA")).toBe("tax");
    expect(kindOf("PAGO CUOTA DE PRESTAMO         1987 BIYCSA")).toBe("loan");
    expect(
      kindOf("PAGO TOTAL CUOTA PMO (7175-330-01573367/5-FVTO:2026-11-04)"),
    ).toBe("loan");
    expect(kindOf("TRANSF DE QUIMSA SRL (30708529636) FAC 000300022272")).toBe(
      "receipt",
    );
    expect(kindOf("CR.TRAN. 30708978554 ELECTRA MERCEDES")).toBe("receipt");
    expect(
      kindOf("COMISION MANTENIM. PERIODO DESDE 28-09-2026 HASTA 28-10-2026"),
    ).toBe("bank_fee");
    expect(kindOf("ALGO NUEVO")).toBeNull();
  });

  it("offers the concept's fixed start as the text of a new rule", () => {
    expect(conceptOf("PAGO CUOTA DE PRESTAMO         1987 BIYCSA")).toBe(
      "PAGO CUOTA DE PRESTAMO",
    );
    expect(conceptOf("TRANSF DE VALDEZ, MONICA ADRIA (23207269824) VAR")).toBe(
      "TRANSF DE VALDEZ, MONICA ADRIA",
    );
  });
});

describe("own transfers", () => {
  it("money carrying the company's CUIT is a transfer, not a collection", () => {
    const p = proposeLine(
      {
        bank_code: null,
        description: "CR.TRAN. 30714637432 DZYSONS SA",
        amount: 5_500_000,
        line_date: "2026-10-15",
      },
      [
        code({
          bank_code: "",
          description_pattern: "CR.TRAN.",
          kind: "receipt",
          chart_account_id: null,
        }),
      ],
      new Map(),
      [],
      "30714637432",
    );
    expect(p.kind).toBe("transfer");
    expect(p.label).toBe("Transferencia entre cuentas propias");
  });
});

describe("a debit that is not the plan's amount (Provincia)", () => {
  // 1573367/5, cuota of October: capital 470.281,22 by the plan; the bank
  // charged interest by days (631.907,74) and 1,6 % of taxes on it.
  const cuota = {
    id: "c27",
    loan_description: "Préstamo",
    number: 27,
    count: 60,
    due_date: "2026-10-04",
    amount: 1110965.45,
    capital: 470281.22,
    iva: 0,
  };

  it("still finds the cuota, within 10 %", () => {
    expect(
      findLoanInstallment({ amount: -1112299.46, line_date: "2026-10-05" }, [
        cuota,
      ])?.id,
    ).toBe("c27");
  });

  it("suggests the plan's capital and the rest as interest", () => {
    expect(suggestLoanSplit(1112299.46, cuota)).toEqual({
      capital: 470281.22,
      interest: 642018.24,
      late_interest: 0,
      iva: 0,
      taxes: 0,
    });
  });
});
