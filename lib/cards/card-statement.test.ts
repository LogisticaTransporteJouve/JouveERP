import { describe, expect, it } from "vitest";

import { parseCardStatement } from "./card-statement";

// The rows of a Banco Galicia VISA Business statement as readPdfLines reads
// them (names and numbers changed; amounts as in a real one).
const STATEMENT = [
  "Resumen N° VI00000000001234567",
  "Tarjeta Crédito VISA BUSINESS",
  "N° Cuenta: 0600000001 Sucursal: 052",
  "01-Oct-26 13-Oct-26 29-Oct-26 11-Nov-26 26-Nov-26 09-Dic-26",
  "SALDO ANTERIOR 7.847.182,16 8,08",
  "13-10-26 SU PAGO EN PESOS -7.847.182,16",
  "13-10-26 SU PAGO EN USD -8,08",
  "DETALLE DEL CONSUMO",
  "20-04-26 * MERPAGO*BLUECARSA 07/09 260733 5.089,86",
  "01-10-26 * PAGOS360*VTVLUJAN 48.528,82",
  "009230",
  "02-10-26 * WWW.ARBA.GOV.AR 000077 1.743.273,00",
  "21-10-26 F Spotify P4843CF3 Spotify PUSD 2,98 499821 2,98",
  "TARJETA 1111 Total Consumos de TITULAR UNO 1.796.891,68 2,98",
  "04-10-26 K AUTOPISTAS URBAN 000000000659111 000001 359.561,15",
  "15-10-26 * SAN CRISTOBAL 1050132732655-001-001 030492 2.465.610,00",
  "TARJETA 2222 Total Consumos de TITULAR DOS 2.825.171,15 0,00",
  "Resumen de tarjeta de credito VISA BUSINESS Página 1 / 2",
  "DETALLE DEL CONSUMO",
  "TARJETA 2222 Total Consumos de TITULAR DOS 2.825.171,15 0,00",
  "29-10-26 IMPUESTO DE SELLOS $ 112.931,73",
  "29-10-26 COMISIÓN MANT DE CTA. 5.867,00",
  "29-10-26 DB IVA $ RESP INSC. 21% 5.867,00 1.232,07",
  "29-10-26 PERCEP.IVA RG2408 3,0% B. 5867,00 176,01",
  "29-10-26 IIBB PERCEP-BSAS 2,00%( 12397,68) 247,95",
  "29-10-26 DB.RG 5617 30% ( 12397,68 ) 3.719,30",
  "4.746.236,89 2,98",
  "TOTAL A PAGAR",
];

describe("parseCardStatement", () => {
  it("reads the cards, their purchases and the bank's charges", () => {
    const r = parseCardStatement(STATEMENT);
    if (!r.ok) throw new Error(r.error);
    const s = r.statement;
    expect(s).toMatchObject({
      number: "VI00000000001234567",
      account_number: "0600000001",
      close_date: "2026-10-29",
      due_date: "2026-11-11",
      total_ars: 4746236.89,
      total_usd: 2.98,
      previous_ars: 7847182.16,
    });
    expect(s.cards.map((c) => [c.last4, c.holder, c.purchases.length])).toEqual(
      [
        ["1111", "TITULAR UNO", 4],
        ["2222", "TITULAR DOS", 2],
      ],
    );
    expect(s.cards[0]!.purchases[0]).toEqual({
      date: "2026-04-20",
      description: "MERPAGO*BLUECARSA",
      installment: "07/09",
      voucher: "260733",
      amount: 5089.86,
      currency: "ARS",
    });
    expect(s.cards[0]!.purchases[1]?.voucher).toBe("009230");
    expect(s.cards[0]!.purchases[3]).toMatchObject({
      description: "Spotify P4843CF3 Spotify",
      amount: 2.98,
      currency: "USD",
    });
    expect(s.charges.map((c) => [c.kind, c.amount])).toEqual([
      ["stamp_tax", 112931.73],
      ["fee", 5867],
      ["iva", 1232.07],
      ["iva_perception", 176.01],
      ["iibb_perception", 247.95],
      ["income_tax_perception", 3719.3],
    ]);
  });

  it("refuses a statement whose purchases do not add up", () => {
    const broken = STATEMENT.map((l) =>
      l.startsWith("02-10-26")
        ? "02-10-26 * WWW.ARBA.GOV.AR 000077 1.743.274,00"
        : l,
    );
    const r = parseCardStatement(broken);
    expect(r.ok).toBe(false);
  });

  it("says when the text is not a card statement", () => {
    expect(parseCardStatement(["Comprobante final"]).ok).toBe(false);
  });
});
