import { describe, expect, it } from "vitest";

import { statementRowsFromPdfLines, statementRowsToCsv } from "./pdf-statement";

const rows = (lines: string[]) => {
  const res = statementRowsFromPdfLines(lines);
  if ("error" in res) throw new Error(res.error);
  return res.rows.map((r) => [r.date, r.amount, r.balance]);
};

describe("statementRowsFromPdfLines", () => {
  it("signs unsigned debit and credit columns from the balances, starting at the previous balance", () => {
    expect(
      rows([
        "FECHA DESCRIPCION REFERENCIA DEBITOS CREDITOS SALDO",
        "SALDO ULTIMO EXTRACTO AL 30/09/2026 1.000,00",
        "05/10/26 ING TRANSF:CLIENTE 549962 200,00 1.200,00",
        "05/10/26 N/D DEBITO PRESTAMOS REC 0 150,50 1.049,50",
        "SALDO FINAL AL DIA 30/10/2026 1.049,50",
      ]),
    ).toEqual([
      ["2026-10-05", 200, 1200],
      ["2026-10-05", -150.5, 1049.5],
    ]);
  });

  it("reads a newest-first statement with signed debits and the causal as bank code", () => {
    const res = statementRowsFromPdfLines([
      "Fecha Nro. de Causal Concepto Importe Saldo",
      "05/11/2026 111 1685 DBCR 25413 S/CR TASA GRAL $ -20,00 $ 980,00",
      "04/11/2026 222 2027 TEF DATANET PR CLIENTE $ 500,00 $ 1.000,00",
    ]);
    if ("error" in res) throw new Error(res.error);
    expect(
      res.rows.map((r) => [
        r.date,
        r.amount,
        r.bankCode,
        r.reference,
        r.description,
      ]),
    ).toEqual([
      ["2026-11-05", -20, "1685", "111", "DBCR 25413 S/CR TASA GRAL"],
      ["2026-11-04", 500, "2027", "222", "TEF DATANET PR CLIENTE"],
    ]);
  });

  it("reads a negative balance written with the minus after it", () => {
    expect(
      rows([
        "01/10/26 TRANSF. AFIP -1.500,00 500,00-",
        "01/10/26 CREDITO DESCUENTO 2.000,00 1.500,00",
      ]),
    ).toEqual([
      ["2026-10-01", -1500, -500],
      ["2026-10-01", 2000, 1500],
    ]);
  });

  it("reads a decimal point and ignores a value date", () => {
    expect(
      rows([
        "30/09/2026 SALDO ANTERIOR 1609637.32",
        "02/10/2026 TRANSF DE CLIENTE (23207269824) VAR 43700.49 02-10 1653337.81",
      ]),
    ).toEqual([["2026-10-02", 43700.49, 1653337.81]]);
  });

  it("leaves out a deposit still in process, like the xlsx's «Pendiente» line", () => {
    expect(
      rows([
        "30/10/2026 SALDO ANTERIOR 100,00",
        "11/11/2026 TRANSFERENCIA DE TERCEROS + $ 50,00 $ 150,00",
        "12/11/2026 CHEQUE DEPOSITADO EN PROCESO + $ 20,00 $ 170,00",
      ]),
    ).toEqual([["2026-11-11", 50, 150]]);
  });

  it("refuses unsigned amounts whose first sign it cannot know", () => {
    const res = statementRowsFromPdfLines([
      "05/10/26 MOVIMIENTO 200,00 1.200,00",
      "06/10/26 OTRO 100,00 1.100,00",
    ]);
    expect(res).toEqual({ error: expect.stringContaining("saldo anterior") });
  });

  it("refuses a PDF with no movements", () => {
    expect(statementRowsFromPdfLines(["Resumen de cuenta"])).toEqual({
      error: "No encontramos movimientos en el PDF.",
    });
  });
});

describe("statementRowsToCsv", () => {
  it("writes the columns the statement import reads", () => {
    expect(
      statementRowsToCsv([
        {
          date: "2026-10-05",
          description: 'PAGO "X"',
          reference: "1",
          bankCode: "2027",
          amount: -1.5,
          balance: 10,
        },
      ]),
    ).toBe(
      'Fecha,Descripción,Referencia,Causal,Importe,Saldo\n2026-10-05,"PAGO ""X""",1,2027,-1.50,10.00',
    );
  });
});
