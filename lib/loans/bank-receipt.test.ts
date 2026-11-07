import { describe, expect, it } from "vitest";

import { parseBankLoanReceipt } from "./bank-receipt";

// Banco Macro's receipt as pdfjs returns its text (party data replaced).
const RECEIPT =
  'Comprobante de pago de préstamo\n\nFecha\n \n04/02/2026\n\nNúmero de operación\n \n7670122511\n\nNúmero de comprobante\n \n7674000161\n\nBanco Macro S.A.\n\nSarmiento 447 - C1041AAI - Ciudad Autónoma de Buenos Aires\nIVA RI: CUIT N 30-50001008-4 - IIBB:901-865.589-2\n\nOrdenante\n\nEMPRESA SA - 0000000\nCALLE 1 - CP: 1000\n30000000007\nRESPONSABLE INSCRIPTO\n\nPago correspondiente al\n\nPréstamo\n \nOTROS PRESTAMOS PESOS\nMonto\n \n$ 771.222,19\nMonto en letras\n \nSetecientos setenta y un mil doscientos veintidós PESOS\ncon diecinueve centavos\nMoneda\n \nPESOS\nForma de pago\n \nNOTA DEBITO CTA CORRIENTE MN\nCuenta débito de pago\n \n000000000000000\nSucursal\n \nMERCEDES\n\nConceptos aplicados\nDetalle\n \nT.N.A.\n \nT.E.M.\n \nMonto\nCuota\n \nT.E.A.\n\nINTERES\n \n2\n \n40,0\n \n48,21\n \n3,33\n \n$ 190.087,54\nIVA PERCEPCION\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 2.851,31\nIVA INTERESES\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 19.959,19\nPER.ING.BR. INTER.\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 4.752,19\nIVA PUNITORIOS\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 75,33\nPER.ING.BR. INT. MORATOR.\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 17,94\nPUNITORIOS\n \n2\n \n20,0\n \n21,94\n \n1,67\n \n$ 717,41\nIVA COMPENSATORIOS\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 150,66\nPER.ING.BR. INT. COMPENS.\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 35,87\nCOMPENSATORIOS\n \n2\n \n40,0\n \n48,21\n \n3,33\n \n$ 1.434,82\nCAPITAL\n \n2\n \n0,00\n \n0,00\n \n0,00\n \n$ 551.139,93\n\nEste comprobante es emitido en forma electrónica y es válido como constancia de pago siempre que los\nfondos hayan sido efectivamente percibidos por el Banco.\nDe acuerdo con la normativa fiscal vigente, si su condición ante el IVA es Consumidor Final, Exento, No\nResponsable o Monotributista (Régimen Simplificado), los montos de IVA discriminados no generan crédito\nfiscal. Asimismo, las retenciones o percepciones de IVA practicadas se informan a través del servicio "Mis\nRetenciones" en la web de AFIP (RG 4523/19), siendo este el único comprobante válido a tales efectos.\nLa emisión de este documento no implica la extinción ni liberación de las obligaciones del deudor por intereses\ncompensatorios, punitorios o cargos pendientes, constituyendo reserva expresa en los términos del Art. 899 del\nCódigo Civil y Comercial de la Nación.\n\nS.E.U.O\n';

describe("parseBankLoanReceipt", () => {
  it("reads the loan, the cuota and where each concept goes", () => {
    const r = parseBankLoanReceipt(RECEIPT);
    expect(r).toEqual({
      ok: true,
      receipts: [
        {
          loan_number: "7670122511",
          receipt_number: "7674000161",
          paid_date: "2026-02-04",
          installment_number: 2,
          total: 771222.19,
          capital: 551139.93,
          interest: 190087.54,
          late_interest: 2152.23,
          iva: 20185.18,
          iva_perception: 2851.31,
          iibb_perception: 4806,
        },
      ],
    });
  });

  it("splits a debit that pays two cuotas into one part per cuota", () => {
    const two = RECEIPT.replace("CAPITAL\n \n2\n", "CAPITAL\n \n3\n");
    const r = parseBankLoanReceipt(two);
    expect(
      r.ok &&
        r.receipts.map((p) => [
          p.receipt_number,
          p.installment_number,
          p.total,
        ]),
    ).toEqual([
      ["7674000161-2", 2, 220082.26],
      ["7674000161-3", 3, 551139.93],
    ]);
  });

  it("refuses a concept it does not know instead of guessing", () => {
    const r = parseBankLoanReceipt(
      RECEIPT.replace("\nPUNITORIOS\n", "\nSEGURO DE VIDA\n"),
    );
    expect(r.ok).toBe(false);
  });

  it("says when the PDF is something else", () => {
    expect(parseBankLoanReceipt("Factura A").ok).toBe(false);
  });
});
