import { describe, expect, it } from "vitest";

import { echeqsToLoad, parseEcheqListado } from "./echeq-listado";

// The shape of Banco Galicia's «Listado de cheques recibidos»: a row of
// groups over the column titles (names and numbers changed).
const groups = [
  "Datos del cheque",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "CBU Deposito",
  "CBU Custodia",
  "Datos del librador",
  "",
  "",
  "Datos del beneficiario actual",
  "",
  "Cantidad",
  "",
  "",
  "Historial de endosos",
  "",
  "",
  "",
  "",
  "",
];
const header = [
  "Nº de cheque",
  "Cláusula",
  "Recibido de",
  "CUIT/CUIL/CDI",
  "Fecha de pago",
  "Fecha de emisión",
  "Importe",
  "Estado",
  "Banco emisor",
  "ID del cheque",
  "CMC7",
  "Motivo y descripción",
  "Emitido a",
  "CUIT/CUIL/CDI",
  "CBU Deposito",
  "CBU Custodia",
  "Razón social",
  "CUIT/CUIL/CDI",
  "C.P del cheque",
  "Razón social",
  "CUIT/CUIL/CDI",
  "Cantidad de endosos",
  "Cantidad de cesiones",
  "Cantidad de avales",
  "Endosante",
  "Beneficiario",
  "CUIT/CUIL/CDI",
  "Estado del endoso",
  "Tipo de endoso",
  "Fecha",
];
const row = (
  n: string,
  from: string,
  fromCuit: string,
  pay: string,
  amount: string,
  status: string,
  endorsedOn = "",
) => [
  n,
  "a la orden",
  from,
  fromCuit,
  pay,
  "2026-10-01",
  amount,
  status,
  "BANCO MACRO S.A.",
  "ID",
  "CMC7",
  "-",
  from,
  fromCuit,
  "",
  "",
  "COOPERATIVA LIBRADORA",
  "30222222229",
  "2111",
  from,
  fromCuit,
  endorsedOn ? "1" : "0",
  "0",
  "0",
  endorsedOn ? from : "",
  endorsedOn ? "EMPRESA SA" : "",
  endorsedOn ? "30000000007" : "",
  endorsedOn ? "aceptado" : "",
  endorsedOn ? "Nominal" : "",
  endorsedOn,
];
const ROWS = [
  groups,
  header,
  row(
    "70755332",
    "CLIENTE UNO SRL",
    "30111111118",
    "2027-01-03",
    "1433696.6",
    "En custodia",
    "2026-11-02",
  ),
  row(
    "00001797",
    "EMPRESA SA",
    "30000000007",
    "2026-11-03",
    "491426",
    "Pagado",
  ),
  row(
    "00001700",
    "CLIENTE UNO SRL",
    "30111111118",
    "2026-09-03",
    "1000",
    "Pagado",
    "2026-09-01",
  ),
  row(
    "00001701",
    "CLIENTE UNO SRL",
    "30111111118",
    "2026-10-20",
    "2000",
    "Rechazado",
    "2026-10-01",
  ),
];

describe("parseEcheqListado", () => {
  it("reads each eCheq with its client and when it was endorsed", () => {
    const r = parseEcheqListado(ROWS, "30000000007");
    if (!r.ok) throw new Error(r.error);
    expect(r.cheques[0]).toEqual({
      check_number: "70755332",
      client_name: "CLIENTE UNO SRL",
      client_cuit: "30111111118",
      drawer_name: "COOPERATIVA LIBRADORA",
      drawer_cuit: "30222222229",
      bank_name: "BANCO MACRO S.A.",
      issue_date: "2026-10-01",
      due_date: "2027-01-03",
      received_date: "2026-11-02",
      amount: 1433696.6,
      status: "En custodia",
    });
  });

  it("takes the drawer as the client of a cheque issued to the company", () => {
    const r = parseEcheqListado(ROWS, "30000000007");
    if (!r.ok) throw new Error(r.error);
    expect(r.cheques[1]).toMatchObject({
      client_name: "COOPERATIVA LIBRADORA",
      client_cuit: "30222222229",
      received_date: "2026-10-01",
    });
  });

  it("loads what is held and what was paid from the date on", () => {
    const r = parseEcheqListado(ROWS, "30000000007");
    if (!r.ok) throw new Error(r.error);
    expect(
      echeqsToLoad(r.cheques, "2026-10-01").map((c) => c.check_number),
    ).toEqual(["70755332", "00001797"]);
  });

  it("says when the sheet is not the listado", () => {
    expect(parseEcheqListado([["Fecha", "Importe"]], "30000000007").ok).toBe(
      false,
    );
  });
});
