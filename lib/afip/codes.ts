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

const KINDS: readonly InvoiceKind[] = ["factura", "nc", "nd"];
const LETTERS: readonly InvoiceLetter[] = ["A", "B", "C"];

const KIND_LETTER_BY_CBTE_TIPO: ReadonlyMap<
  number,
  { kind: InvoiceKind; letter: InvoiceLetter }
> = new Map(
  KINDS.flatMap((kind) =>
    LETTERS.map(
      (letter) =>
        [CBTE_TIPO_BY_KIND_LETTER[kind][letter], { kind, letter }] as const,
    ),
  ),
);

/** Kind and letter of a CbteTipo the ERP models (A, B, C facturas, NC and
 *  ND); null for any other (FCE MiPyME, M, tickets…). */
export function kindLetterForCbteTipo(
  cbteTipo: number,
): { kind: InvoiceKind; letter: InvoiceLetter } | null {
  return KIND_LETTER_BY_CBTE_TIPO.get(cbteTipo) ?? null;
}

/** Received vouchers the ERP loads as one of its kinds and letters while the
 *  purchase keeps the voucher's own AFIP code (purchase_invoices.cbte_tipo_afip)
 *  for the Libro IVA TXT: recibos (4, 9, 15), liquidaciones (63, 64) and
 *  public-service liquidaciones (17, 18: electricity, gas…) as a factura of
 *  their letter, and the M vouchers (51, 52, 53, 54), which discriminate IVA
 *  for the buyer as an A does. */
const PURCHASE_OWN_CODE_TIPOS: ReadonlyMap<
  number,
  { kind: InvoiceKind; letter: InvoiceLetter; label: string }
> = new Map([
  [4, { kind: "factura", letter: "A", label: "Recibo A" }],
  [9, { kind: "factura", letter: "B", label: "Recibo B" }],
  [15, { kind: "factura", letter: "C", label: "Recibo C" }],
  [63, { kind: "factura", letter: "A", label: "Liquidación A" }],
  [64, { kind: "factura", letter: "B", label: "Liquidación B" }],
  [
    17,
    {
      kind: "factura",
      letter: "A",
      label: "Liquidación de servicios públicos A",
    },
  ],
  [
    18,
    {
      kind: "factura",
      letter: "B",
      label: "Liquidación de servicios públicos B",
    },
  ],
  [54, { kind: "factura", letter: "A", label: "Recibo M" }],
  [51, { kind: "factura", letter: "A", label: "Factura M" }],
  [52, { kind: "nd", letter: "A", label: "Nota de débito M" }],
  [53, { kind: "nc", letter: "A", label: "Nota de crédito M" }],
]);

/** Whether a received voucher's code is kept on its purchase. */
export function purchaseKeepsOwnCode(cbteTipo: number): boolean {
  return PURCHASE_OWN_CODE_TIPOS.has(cbteTipo);
}

/** What a received voucher's code is as a purchase: an ERP kind and letter,
 *  or the kind and letter a recibo, liquidación or M loads as; null for any
 *  other (FCE MiPyME, tickets…). */
export function purchaseKindLetterForCbteTipo(
  cbteTipo: number,
): { kind: InvoiceKind; letter: InvoiceLetter } | null {
  const own = PURCHASE_OWN_CODE_TIPOS.get(cbteTipo);
  return own
    ? { kind: own.kind, letter: own.letter }
    : kindLetterForCbteTipo(cbteTipo);
}

/** A recibo, liquidación or M voucher's own name («Factura M»), or null for
 *  the codes the ERP names by kind and letter. */
export function purchaseOwnTipoLabel(cbteTipo: number): string | null {
  return PURCHASE_OWN_CODE_TIPOS.get(cbteTipo)?.label ?? null;
}

// Only a letter A voucher discriminates IVA for the buyer: on B and C the IVA,
// exento and no gravado are part of the price.
export function ivaIsComputable(letter: string | null): boolean {
  return letter === "A";
}

export type VoucherAmountParts = {
  imp_neto: number;
  imp_no_gravado: number;
  imp_op_exentas: number;
  imp_iva: number;
};

/** The parts as a buyer books them: on a B or C voucher everything but the
 *  tributes is net, so the total stays the same. */
export function foldNonComputable(
  letter: string | null,
  parts: VoucherAmountParts,
): VoucherAmountParts {
  if (ivaIsComputable(letter)) return parts;
  return {
    imp_neto: +(
      parts.imp_neto +
      parts.imp_no_gravado +
      parts.imp_op_exentas +
      parts.imp_iva
    ).toFixed(2),
    imp_no_gravado: 0,
    imp_op_exentas: 0,
    imp_iva: 0,
  };
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

export function isCondicionIvaReceptorCode(
  value: unknown,
): value is CondicionIvaReceptorCode {
  return Object.values(CONDICION_IVA_RECEPTOR).some((code) => code === value);
}

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

/** A voucher's receiver: a fiscal client by CUIT and IVA condition; an Otras
 *  ventas client, which has neither, as an unidentified receiver (doc 99). */
export function voucherReceptor(client: {
  cuit: string | null;
  iva_condition: IvaCondition | null;
}): {
  doc_tipo: DocTipoCode;
  doc_nro: string;
  iva_condition_receptor: CondicionIvaReceptorCode | null;
} {
  if (client.cuit && client.iva_condition) {
    return {
      doc_tipo: DOC_TIPO.CUIT,
      doc_nro: client.cuit,
      iva_condition_receptor: condicionIvaReceptorFor(client.iva_condition),
    };
  }
  return {
    doc_tipo: DOC_TIPO.CONSUMIDOR_FINAL,
    doc_nro: "0",
    iva_condition_receptor: null,
  };
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

/** Every IVA rate AFIP defines, low to high, for a form's select. */
export const IVA_RATE_OPTIONS: ReadonlyArray<{
  value: IvaRateId;
  label: string;
}> = [
  { value: IVA_RATE.ZERO, label: "0%" },
  { value: IVA_RATE.TWO_FIVE, label: "2.5%" },
  { value: IVA_RATE.FIVE, label: "5%" },
  { value: IVA_RATE.TEN_FIVE, label: "10.5%" },
  { value: IVA_RATE.TWENTY_ONE, label: "21%" },
  { value: IVA_RATE.TWENTY_SEVEN, label: "27%" },
];

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

/** The AFIP rate id of an alícuota written as a percent (21, 10.5, 27…);
 *  null when it is not one AFIP defines. */
export function ivaRateIdForPercent(percent: number): IvaRateId | null {
  for (const option of IVA_RATE_OPTIONS) {
    if (IVA_RATE_PERCENT[option.value] === percent) return option.value;
  }
  return null;
}

// --------------------------------------------------------------------------
// Currency codes.
// --------------------------------------------------------------------------
export const MONEDA = {
  PESOS: "PES",
  DOLARES: "DOL",
} as const;

export type MonedaCode = (typeof MONEDA)[keyof typeof MONEDA];
