import { describe, expect, it } from "vitest";

import { CONDICION_IVA_RECEPTOR } from "@/lib/afip/codes";

import {
  isFacturaBToConsumidorFinal,
  isLetterAToMonotributo,
  type InvoiceTemplateData,
} from "./invoice-template";

function voucher(
  letter: "A" | "B",
  condicion: number | null,
  isFiscal = true,
): InvoiceTemplateData {
  return {
    isFiscal,
    emisor: {
      legal_name: "Emisor S.A.",
      cuit: "30000000007",
      iva_condition: "IVA Responsable Inscripto",
      address: null,
      division_label: "Logística Jouve",
      iibb_number: null,
      inicio_actividades: null,
    },
    receptor: {
      legal_name: "Cliente",
      doc_tipo_label: "CUIT",
      doc_nro: "20000000001",
      iva_condition_label: "—",
      condicion_iva_receptor: condicion,
      address: null,
    },
    kind: "factura",
    letter,
    punto_venta: 3,
    numero: 1,
    fecha: "2026-10-16",
    fch_serv_desde: null,
    fch_serv_hasta: null,
    fch_vto_pago: null,
    concepto_label: "Servicios",
    items: [],
    imp_neto: 100,
    imp_iva: 21,
    imp_trib: 0,
    imp_tot_conc: 0,
    imp_op_ex: 0,
    imp_total: 121,
    per_rate: [],
    moneda: "PES",
    cotizacion: 1,
    cae: "70000000000000",
    cae_vencimiento: "2026-10-26",
    qr_data_url: null,
  };
}

describe("invoice legends", () => {
  it("prints the transparency legend on a B to a consumidor final identified by CUIT", () => {
    expect(
      isFacturaBToConsumidorFinal(
        voucher("B", CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL),
      ),
    ).toBe(true);
    expect(
      isFacturaBToConsumidorFinal(voucher("B", CONDICION_IVA_RECEPTOR.EXENTO)),
    ).toBe(false);
  });

  it("prints the Ley 27.618 legend only on an A to a monotributista", () => {
    expect(
      isLetterAToMonotributo(voucher("A", CONDICION_IVA_RECEPTOR.MONOTRIBUTO)),
    ).toBe(true);
    expect(
      isLetterAToMonotributo(
        voucher("A", CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO),
      ),
    ).toBe(false);
    expect(
      isLetterAToMonotributo(
        voucher("A", CONDICION_IVA_RECEPTOR.MONOTRIBUTO, false),
      ),
    ).toBe(false);
  });
});
