// AFIP code tables for WSFEv1 emission.
//
// Stable codes from RG 4291 (CbteTipo, Concepto, DocTipo, Iva.Id) and RG 5616
// (CondicionIVAReceptorId, mandatory since 2024). They change so rarely that
// hardcoding is preferred over a runtime sync via FEParamGet*. If AFIP adds a
// new code we update this file.
//
// The maps below are exhaustive on the values JouveERP needs. We don't model
// MiPyMEs (FCE) or Bonos Fiscales — they live in different webservices.

import type { IvaCondition } from "@/features/clients/schema";

// --------------------------------------------------------------------------
// CbteTipo — type of voucher.
// --------------------------------------------------------------------------
export const CBTE_TIPO = {
  FACTURA_A: 1,
  ND_A: 2,
  NC_A: 3,
  FACTURA_B: 6,
  ND_B: 7,
  NC_B: 8,
  FACTURA_C: 11,
  ND_C: 12,
  NC_C: 13,
} as const;

export type CbteTipoCode = (typeof CBTE_TIPO)[keyof typeof CBTE_TIPO];

export type InvoiceKind = "factura" | "nc" | "nd";
export type InvoiceLetter = "A" | "B" | "C";

const CBTE_TIPO_BY_KIND_LETTER: Record<
  InvoiceKind,
  Record<InvoiceLetter, CbteTipoCode>
> = {
  factura: { A: 1, B: 6, C: 11 },
  nd: { A: 2, B: 7, C: 12 },
  nc: { A: 3, B: 8, C: 13 },
};

export function cbteTipoFor(
  kind: InvoiceKind,
  letter: InvoiceLetter,
): CbteTipoCode {
  return CBTE_TIPO_BY_KIND_LETTER[kind][letter];
}

// --------------------------------------------------------------------------
// Concepto — what the voucher invoices.
// --------------------------------------------------------------------------
export const CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;

export type ConceptoCode = (typeof CONCEPTO)[keyof typeof CONCEPTO];

export function isServiciosConcepto(c: number): boolean {
  return c === CONCEPTO.SERVICIOS || c === CONCEPTO.PRODUCTOS_Y_SERVICIOS;
}

// --------------------------------------------------------------------------
// DocTipo — recipient's document type.
// --------------------------------------------------------------------------
export const DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
} as const;

export type DocTipoCode = (typeof DOC_TIPO)[keyof typeof DOC_TIPO];

// --------------------------------------------------------------------------
// CondicionIVAReceptorId — RG 5616, mandatory since 2024.
// --------------------------------------------------------------------------
export const CONDICION_IVA_RECEPTOR = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 7,
  PROVEEDOR_EXTERIOR: 8,
  CLIENTE_EXTERIOR: 9,
  IVA_LIBERADO: 10,
  MONOTRIBUTO_SOCIAL: 13,
  IVA_NO_ALCANZADO: 15,
  MONOTRIBUTO_PROMOVIDO: 16,
} as const;

export type CondicionIvaReceptorCode =
  (typeof CONDICION_IVA_RECEPTOR)[keyof typeof CONDICION_IVA_RECEPTOR];

// Maps our internal `clients.iva_condition` to AFIP's CondicionIVAReceptorId.
const IVA_CONDITION_TO_RECEPTOR: Record<
  IvaCondition,
  CondicionIvaReceptorCode
> = {
  responsable_inscripto: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
  monotributo: CONDICION_IVA_RECEPTOR.MONOTRIBUTO,
  exento: CONDICION_IVA_RECEPTOR.EXENTO,
  consumidor_final: CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
  no_categorizado: CONDICION_IVA_RECEPTOR.NO_CATEGORIZADO,
};

export function condicionIvaReceptorFor(
  iva: IvaCondition,
): CondicionIvaReceptorCode {
  return IVA_CONDITION_TO_RECEPTOR[iva];
}

// --------------------------------------------------------------------------
// Letter resolution — given issuer + recipient IVA conditions, what letter?
//
// Rules (single-CUIT, issuer = Responsable Inscripto):
//   - Recipient RI or Monotributo → letter A (RG 5003: monotributistas
//     receive A, with the Ley 27.618 legend on the printed voucher)
//   - Recipient Exento / Consumidor Final / No categorizado → B
//   - If the issuer were monotributo, all letters would be C — not our case today.
// --------------------------------------------------------------------------
export function letterFor(receptorIva: IvaCondition): InvoiceLetter {
  if (receptorIva === "responsable_inscripto" || receptorIva === "monotributo")
    return "A";
  return "B";
}

// RG 5616 class table (FEParamGetCondicionIvaReceptor, Cmp_Clase): which
// CondicionIVAReceptorId values AFIP accepts for each voucher letter. AFIP
// rejects a voucher whose letter and receptor condition don't match.
const RECEPTOR_CONDITIONS_BY_LETTER: Record<
  InvoiceLetter,
  readonly CondicionIvaReceptorCode[]
> = {
  A: [
    CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
    CONDICION_IVA_RECEPTOR.MONOTRIBUTO,
    CONDICION_IVA_RECEPTOR.MONOTRIBUTO_SOCIAL,
    CONDICION_IVA_RECEPTOR.MONOTRIBUTO_PROMOVIDO,
  ],
  B: [
    CONDICION_IVA_RECEPTOR.EXENTO,
    CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    CONDICION_IVA_RECEPTOR.NO_CATEGORIZADO,
    CONDICION_IVA_RECEPTOR.PROVEEDOR_EXTERIOR,
    CONDICION_IVA_RECEPTOR.CLIENTE_EXTERIOR,
    CONDICION_IVA_RECEPTOR.IVA_LIBERADO,
    CONDICION_IVA_RECEPTOR.IVA_NO_ALCANZADO,
  ],
  C: Object.values(CONDICION_IVA_RECEPTOR),
};

export function isReceptorConditionValidForLetter(
  letter: InvoiceLetter,
  receptor: CondicionIvaReceptorCode,
): boolean {
  return RECEPTOR_CONDITIONS_BY_LETTER[letter].includes(receptor);
}

// --------------------------------------------------------------------------
// Iva — rate IDs and percentages.
// --------------------------------------------------------------------------
export const IVA_RATE = {
  ZERO: 3, // 0%
  TEN_FIVE: 4, // 10.5%
  TWENTY_ONE: 5, // 21%
  TWENTY_SEVEN: 6, // 27%
  FIVE: 8, // 5%
  TWO_FIVE: 9, // 2.5%
} as const;

export type IvaRateId = (typeof IVA_RATE)[keyof typeof IVA_RATE];

export const IVA_RATE_PERCENT: Record<IvaRateId, number> = {
  3: 0,
  4: 10.5,
  5: 21,
  6: 27,
  8: 5,
  9: 2.5,
};

export function ivaRatePercent(id: IvaRateId): number {
  return IVA_RATE_PERCENT[id];
}

// --------------------------------------------------------------------------
// Currency codes.
// --------------------------------------------------------------------------
export const MONEDA = {
  PESOS: "PES",
  DOLARES: "DOL",
} as const;

export type MonedaCode = (typeof MONEDA)[keyof typeof MONEDA];
