import { describe, expect, it } from "vitest";

import type { BankStatementCode, StatementClient } from "../schema";
import {
  GALICIA_CODES,
  PROVINCIA_CODES,
  counterpartyOf,
  detectBankPreset,
  findCardStatement,
  findCarteraCheck,
  findSaleTransfers,
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
    expect(kindOf("CR.TRAN. 30111111118 CLIENTE UNO")).toBe("receipt");
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

  it("splits the rest into interest and taxes at the last cuota's rate", () => {
    // 1573367/5 cuota 28: the bank's detail is capital 481.646,35,
    // intereses 641.388,24, impuestos 10.262,20; 1,6 % comes from
    // 1367511/2 cuota 108 (603,30 on 37.709,58, rounded).
    expect(
      suggestLoanSplit(1133296.79, {
        capital: 481646.35,
        iva: 0,
        tax_rate: 0.016,
      }),
    ).toEqual({
      capital: 481646.35,
      // The bank's own rounding lands a cent away (641.388,24 / 10.262,20).
      interest: 641388.23,
      late_interest: 0,
      iva: 0,
      taxes: 10262.21,
    });
  });
});

describe("detectBankPreset", () => {
  const line = (bank_code: string, description: string) => ({
    bank_code,
    description,
  });

  it("knows Provincia by its concepts and Macro by its codes", () => {
    expect(
      detectBankPreset([
        line("", "IMPUESTO DEBITO - LEY 25413"),
        line("", "RETENCION ARBA                 0023"),
        line("", "TRANSF DE ANDINO OUTFITTERS SO (33718235559) VAR"),
      ]),
    ).toBe("provincia");
    expect(
      detectBankPreset([
        line("1684", "IMP DEB LEY 25413"),
        line("361", "PAGO PRESTAMO"),
      ]),
    ).toBe("macro");
  });

  it("guesses nothing from one line or unknown ones", () => {
    expect(detectBankPreset([line("", "RETENCION ARBA")])).toBeNull();
    expect(
      detectBankPreset([line("9", "OTRA COSA"), line("", "ALGO")]),
    ).toBeNull();
  });
});

describe("counterpartyOf", () => {
  it("reads who sent a transfer from Provincia's concepts", () => {
    expect(
      counterpartyOf("TRANSF DE ANDINO OUTFITTERS SO (33718235559) VAR"),
    ).toEqual({ cuit: "33718235559", name: "ANDINO OUTFITTERS SO" });
    expect(counterpartyOf("CR.TRAN. 30111111118 CLIENTE UNO")).toEqual({
      cuit: "30111111118",
      name: "CLIENTE UNO",
    });
    expect(
      counterpartyOf("TRANSF DE VALDEZ, MONICA ADRIA (23207269824) VAR VARIOS"),
    ).toEqual({ cuit: "23207269824", name: "VALDEZ, MONICA ADRIA" });
  });
});

describe("Banco Galicia's codes", () => {
  const codes = GALICIA_CODES.map((c, i) =>
    code({
      id: `g${i}`,
      bank_code: "",
      description_pattern: c.description_pattern,
      kind: c.kind,
      label: c.label,
    }),
  );
  const labelOf = (description: string) =>
    findBankCode({ bank_code: null, description }, codes)?.label ?? null;

  it("reads each concept by its whole words", () => {
    expect(labelOf("Iva")).toBe("IVA del descuento de cheques");
    expect(labelOf("Percep. Iva")).toBe("Percepción de IVA");
    expect(labelOf("Ing. Brutos S/ Cred · LEY 12837-BS.AS.")).toBe(
      "Recaudación IIBB sobre créditos (ARBA)",
    );
    expect(
      labelOf("Transferencia De Terceros · RIVADAVIA SRL · 30711111118"),
    ).toBe("Transferencia recibida");
    expect(labelOf("Trf Inmed Proveed · RIVAS JUAN · VARIOS")).toBe(
      "Pago a proveedor",
    );
  });

  it("does not take a pattern inside another word", () => {
    expect(labelOf("Debito Directo · RIVADAVIA SEGUROS")).toBeNull();
  });

  it("guesses no bank on a tie", () => {
    expect(
      detectBankPreset([
        { bank_code: null, description: "Iva" },
        { bank_code: null, description: "Percep. Iva" },
        { bank_code: null, description: "IMPUESTO DEBITO - LEY 25413" },
        { bank_code: null, description: "RETENCION ARBA" },
      ]),
    ).toBeNull();
  });

  it("knows a Galicia statement", () => {
    expect(
      detectBankPreset([
        { bank_code: null, description: "Imp. Deb. Ley 25413 Gral." },
        { bank_code: null, description: "Ing. Brutos S/ Cred" },
      ]),
    ).toBe("galicia");
  });
});

describe("findSaleTransfers", () => {
  // Galicia's operation 0001234567 of 03/11: six cheques sold, one credit
  // per «N° de préstamo» (2059 and 5473 share one).
  const t = (id: string, amount: number) => ({
    id,
    sale_id: "s1",
    date: "2026-11-03",
    amount,
    description: `Venta cheque ${id} a Banco Galicia`,
  });
  const sale = [
    t("1796", 134384),
    t("2059", 165878.39),
    t("5473", 7056795.16),
    t("10114175", 1528950.25),
    t("10024214", 3547538.5),
    t("41072338", 1144309.6),
  ];

  it("finds the cheques of each credit", () => {
    const ids = (amount: number) =>
      findSaleTransfers({ amount, line_date: "2026-11-03" }, sale)
        ?.map((x) => x.id)
        .sort();
    expect(ids(7222673.55)).toEqual(["2059", "5473"]);
    expect(ids(134384)).toEqual(["1796"]);
    expect(ids(1144309.6)).toEqual(["41072338"]);
  });

  it("finds nothing for another amount or a far date", () => {
    expect(
      findSaleTransfers({ amount: 1000, line_date: "2026-11-03" }, sale),
    ).toBeNull();
    expect(
      findSaleTransfers({ amount: 134384, line_date: "2026-11-20" }, sale),
    ).toBeNull();
  });
});

describe("findCardStatement", () => {
  const visa = {
    id: "v1",
    label: "VISA 0600000001 cierre 29/10/2026",
    close_date: "2026-10-29",
    due_date: "2026-11-11",
    total_ars: 1250000.5,
    total_usd: 10,
    ars_pending: true,
    usd_pending: true,
    undefined_ars: 0,
    undefined_usd: 0,
  };
  // Galicia writes the same text on the pesos and the dollars debits.
  const debit = (amount: number, line_date = "2026-11-11") => ({
    amount,
    line_date,
    description: "Pago Visa Empresa · DEBITO AUTOMATICO AL VENCIMIENTO",
  });

  it("pays the pesos with the debit of their total", () => {
    expect(findCardStatement(debit(-1250000.5), [visa])).toEqual({
      statement: visa,
      currency: "ARS",
    });
  });

  it("takes the other debit of the payment as the dollars", () => {
    expect(findCardStatement(debit(-15376.12), [visa])?.currency).toBe("USD");
  });

  it("never takes a debit before the close as this statement's dollars", () => {
    expect(
      findCardStatement(debit(-15376.12, "2026-10-13"), [visa]),
    ).toBeNull();
  });

  it("never takes a debit long past the due date as its dollars", () => {
    expect(
      findCardStatement(debit(-15376.12, "2026-12-01"), [visa]),
    ).toBeNull();
  });

  it("finds nothing once the dollars are paid and the pesos do not match", () => {
    expect(
      findCardStatement(debit(-15376.12), [{ ...visa, usd_pending: false }]),
    ).toBeNull();
  });
});

describe("findCarteraCheck", () => {
  const c = (id: string, check_number: string, amount: number) => ({
    id,
    check_number,
    amount,
    due_date: "2026-10-09",
    drawer_name: "CLIENTE",
  });
  const cartera = [
    c("a", "10365334", 4612),
    c("b", "00001763", 649643),
    c("c", "99", 4612),
  ];

  it("finds the deposited cheque by the number the bank writes", () => {
    expect(
      findCarteraCheck(
        { amount: 4612, description: "G.de Echeq   Q10365334 Bol38694344" },
        cartera,
      )?.id,
    ).toBe("a");
    expect(
      findCarteraCheck(
        { amount: 649643, description: "G. De Echeq Galicia Q    1763" },
        cartera,
      )?.id,
    ).toBe("b");
  });

  it("never takes another cheque when the line names its number", () => {
    expect(
      findCarteraCheck(
        { amount: 649643, description: "G.de Echeq   Q55555555 Bol1" },
        [c("b", "00001763", 649643)],
      ),
    ).toBeNull();
  });

  it("does not guess between cheques of the same amount", () => {
    expect(
      findCarteraCheck({ amount: 4612, description: "Deposito" }, cartera),
    ).toBeNull();
  });
});
