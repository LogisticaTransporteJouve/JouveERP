import { describe, expect, it } from "vitest";

import { parseLeasingStatement } from "./leasing-statement";

// Mercedes-Benz Compañía Financiera's statements as pdfjs returns their text
// (party data replaced, from «ÚLTIMOS PAGOS» on left out).
const CUOTA_21 =
  "DATOS DEL CLIENTE\n\nCALLE 1\n\nNro:\n \n1131133\n\n19/10/2026\n\nCP 1000\n\nFECHA:\n\nIVA RESPONSABLE INSCRIPTO\nREIMPRESION DEL RESUMEN DE CUENTA\n30-70700229-4\nCUIT Nº\n\nTel: 0800-2222-MBF(623)\nMercedes Benz Compañía Financiera Argentina S.A.\n139499\n\nDATOS GENERALES\n\nCALLE 2\n(6600)\nRESP. INSCRIPTO\n28\nCuotas Restantes\nCuenta\nTipo y Nro de Doc:\nDomicilio:\n29.00\n30000000007\n28076\nOperación\n33.19\n37.27\nEMPRESA SA\n \nCUIT\nCFT\nCondición fiscal:\nTEA\nTNA\n$ 91,413,762.85\n$ 128,478,254.48\nSaldo de Capital\nMonto Financiado\nCodeudor:\n \nOtro Titular:\nSin Codeudor\n \nSin Otro Titular\n\nDEUDA ANTERIOR (2)\n\nConcepto\n \nCuota/s\n \nImporte Total\n0.00\n0.00\nTotal Deuda Anterior\n\nCUOTA ACTUAL (1)\n\nConcepto\n \nCuota\n \nVto.\n \nImporte\n \nIVA\nCapital Leasing\n \n21\n \n28/10/2026\n \n2,190,131.30\n \n459,927.57\nInteres Leasing\n \n21\n \n28/10/2026\n \n2,178,903.39\n \n457,569.71\nSeguro automotor\n \n21\n \n28/10/2026\n \n381,897.45\n \n76,452.30\n4,750,932.14\n \n993,949.58\n5,744,881.72\nTotal\nTotal Cuota Actual\n\nINTERESES COMP. Y PUNIT. (3)\n\nConcepto\n \nCuota/s\n \nImporte Total\n0.00\n0.00\nTotal Int. Comp. y Punit.\n\nOTRAS DEUDAS (4)\n\n0.00\nTotal Otras Deudas\n\nDEUDA TOTAL CONSOLIDADA\n\n(1) Cuota Actual\n(2) Deuda Anterior\n(3) Intereses Comp. y Punit.\n(4) Otras Deudas\nTOTAL GENERAL (1) + (2) + (3) + (4)\n5,744,881.72\n0.00\n0.00\n0.00\n5,744,881.72\n\n";

const CUOTA_22 =
  "DATOS DEL CLIENTE\n\nCALLE 1\n \n11/11/2026\n\nCP 1000\n\nFECHA:\n\nIVA RESPONSABLE INSCRIPTO\nCONSULTA DE CUENTA ON LINE\n30-70700229-4\nCUIT Nº\n\nTel: 0800-2222-MBF(623)\nMercedes Benz Compañía Financiera Argentina S.A.\n139499\n\nDATOS GENERALES\n\nCALLE 2\n(6600)\nRESP. INSCRIPTO\n27\nCuotas Restantes\nCuenta\nTipo y Nro de Doc:\nDomicilio:\n29.00\n30000000007\n28076\nOperación\n33.19\n37.27\nEMPRESA SA\n \nCUIT\nCFT\nCondición fiscal:\nTEA\nTNA\n$ 89,223,631.55\n$ 128,478,254.48\nSaldo de Capital\nMonto Financiado\nCodeudor:\n \nOtro Titular:\nSin Codeudor\n \nSin Otro Titular\n\nDEUDA ANTERIOR (2)\n\nConcepto\n \nCuota/s\n \nImporte Total\n0.00\n0.00\nTotal Deuda Anterior\n\nCUOTA ACTUAL (1)\n\nConcepto\n \nCuota\n \nVto.\n \nImporte\n \nIVA\nCapital Leasing\n \n22\n \n30/11/2026\n \n2,029,664.41\n \n426,229.53\nInteres Leasing\n \n22\n \n30/11/2026\n \n2,339,370.28\n \n491,267.76\nMBF - Patentes\n \n22\n \n30/11/2026\n \n597,712.22\n \n0.00\nSeguro automotor\n \n22\n \n30/11/2026\n \n381,897.53\n \n76,452.32\n5,348,644.44\n \n993,949.61\n6,342,594.05\nTotal\nTotal Cuota Actual\n\nINTERESES COMP. Y PUNIT. (3)\n\nConcepto\n \nCuota/s\n \nImporte Total\n0.00\n0.00\nTotal Int. Comp. y Punit.\n\nOTRAS DEUDAS (4)\n\n0.00\nTotal Otras Deudas\n\nDEUDA TOTAL CONSOLIDADA\n\n(1) Cuota Actual\n(2) Deuda Anterior\n(3) Intereses Comp. y Punit.\n(4) Otras Deudas\nTOTAL GENERAL (1) + (2) + (3) + (4)\n6,342,594.05\n0.00\n0.00\n0.00\n6,342,594.05\n\n";

describe("parseLeasingStatement", () => {
  it("reads the cuota: capital, interest, their IVA and the insurance", () => {
    expect(parseLeasingStatement(CUOTA_21)).toEqual({
      ok: true,
      statement: {
        operation: "139499",
        installment_number: 21,
        due_date: "2026-10-28",
        capital: 2190131.3,
        interest: 2178903.39,
        iva: 917497.28,
        charges: [
          {
            concept: "seguro",
            description: "Seguro automotor",
            amount: 381897.45,
            iva_amount: 76452.3,
          },
        ],
        total: 5744881.72,
      },
    });
  });

  it("reads the patentes of an even cuota, with no IVA", () => {
    const r = parseLeasingStatement(CUOTA_22);
    expect(r.ok && r.statement.charges).toEqual([
      {
        concept: "patentes",
        description: "MBF - Patentes",
        amount: 597712.22,
        iva_amount: 0,
      },
      {
        concept: "seguro",
        description: "Seguro automotor",
        amount: 381897.53,
        iva_amount: 76452.32,
      },
    ]);
    expect(r.ok && [r.statement.installment_number, r.statement.total]).toEqual(
      [22, 6342594.05],
    );
  });

  it("bills what is overdue, sections (2) and (3), as mora", () => {
    const late = CUOTA_21.replace(
      "0.00\n0.00\nTotal Deuda Anterior",
      "Cuota\n \n20\n \n1,000.00\n1,000.00\nTotal Deuda Anterior",
    ).replace(
      "0.00\n0.00\nTotal Int. Comp. y Punit.",
      "Punitorios\n \n20\n \n250.50\n250.50\nTotal Int. Comp. y Punit.",
    );
    const r = parseLeasingStatement(late);
    expect(r.ok && r.statement.charges.slice(1)).toEqual([
      {
        concept: "mora",
        description: "Deuda anterior",
        amount: 1000,
        iva_amount: 0,
      },
      {
        concept: "mora",
        description: "Intereses compensatorios y punitorios",
        amount: 250.5,
        iva_amount: 0,
      },
    ]);
    expect(r.ok && r.statement.total).toBe(5746132.22);
  });

  it("refuses a cuota whose concepts do not add up to its total", () => {
    const r = parseLeasingStatement(
      CUOTA_21.replace("5,744,881.72\nTotal", "5,744,881.99\nTotal"),
    );
    expect(r).toEqual({
      ok: false,
      error:
        "Los conceptos de la cuota suman 5744881.72 y el total es 5744881.99.",
    });
  });

  it("refuses another document", () => {
    expect(parseLeasingStatement("Comprobante de pago de préstamo\n")).toEqual({
      ok: false,
      error: "No es un resumen de cuota de Mercedes-Benz Compañía Financiera.",
    });
  });
});
