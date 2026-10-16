// WSFEv1 request rules AFIP enforces on FECAESolicitar, checked before the
// draft is created so a voucher AFIP would reject never reaches the queue
// (where a rejection costs a failed invoice and, for shipments and storage, a
// manual cleanup). Pure: callers resolve the receptor, origin and today's date.

import {
  CONCEPTO,
  DOC_TIPO,
  MONEDA,
  isReceptorConditionValidForLetter,
  isServiciosConcepto,
  type CondicionIvaReceptorCode,
  type InvoiceKind,
  type InvoiceLetter,
} from "./codes";

export type FiscalVoucherDraft = {
  kind: InvoiceKind;
  letter: InvoiceLetter;
  receptor: CondicionIvaReceptorCode;
  docTipo: number;
  docNro: string;
  concepto: number;
  /** yyyy-mm-dd */
  fecha: string;
  fchServDesde: string | null;
  fchServHasta: string | null;
  fchVtoPago: string | null;
  moneda: string;
  cotizacion: number;
  /** The voucher an NC/ND corrects; null for a factura. */
  origin: { letter: InvoiceLetter | null; moneda: string } | null;
};

/** Days CbteFch may sit away from today: ±5 for productos, ±10 otherwise. */
function fechaToleranceDays(concepto: number): number {
  return concepto === CONCEPTO.PRODUCTOS ? 5 : 10;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    Number(fromIso.slice(0, 4)),
    Number(fromIso.slice(5, 7)) - 1,
    Number(fromIso.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toIso.slice(0, 4)),
    Number(toIso.slice(5, 7)) - 1,
    Number(toIso.slice(8, 10)),
  );
  return Math.round((to - from) / 86_400_000);
}

/** First rule the draft breaks, as a message the user can act on; null if
 *  AFIP should accept it. `today` is the Argentina calendar day. */
export function fiscalVoucherIssue(
  draft: FiscalVoucherDraft,
  today: string,
): string | null {
  if (!isReceptorConditionValidForLetter(draft.letter, draft.receptor)) {
    return `La condición de IVA del cliente no admite comprobantes ${draft.letter}. Revisá la condición de IVA del cliente.`;
  }
  if (draft.letter === "A" && draft.docTipo !== DOC_TIPO.CUIT) {
    return "Los comprobantes A requieren el CUIT del cliente.";
  }
  if (draft.docTipo === DOC_TIPO.CUIT && !/^\d{11}$/.test(draft.docNro)) {
    return "El CUIT del cliente tiene que tener 11 dígitos, sin guiones.";
  }

  if (draft.origin) {
    if (draft.origin.letter !== draft.letter) {
      return `La nota tiene que ser de la misma letra que el comprobante de origen (${draft.origin.letter ?? "sin letra"}).`;
    }
    if (draft.origin.moneda !== draft.moneda) {
      return "La nota tiene que estar en la misma moneda que el comprobante de origen.";
    }
  }

  const offset = daysBetween(today, draft.fecha);
  const tolerance = fechaToleranceDays(draft.concepto);
  if (Math.abs(offset) > tolerance) {
    return `La fecha del comprobante tiene que estar dentro de los ${tolerance} días de hoy.`;
  }

  if (isServiciosConcepto(draft.concepto)) {
    if (!draft.fchServDesde || !draft.fchServHasta || !draft.fchVtoPago) {
      return "En servicios hacen falta las fechas de servicio desde, hasta y vencimiento de pago.";
    }
    if (draft.fchServDesde > draft.fchServHasta) {
      return "La fecha de servicio desde no puede ser posterior a la fecha hasta.";
    }
    if (draft.fchVtoPago < draft.fecha) {
      return "El vencimiento de pago no puede ser anterior a la fecha del comprobante.";
    }
  }

  if (draft.moneda === MONEDA.PESOS && draft.cotizacion !== 1) {
    return "Un comprobante en pesos lleva cotización 1.";
  }
  if (draft.moneda !== MONEDA.PESOS && draft.cotizacion <= 1) {
    return "Cargá la cotización del dólar del día para el comprobante en dólares.";
  }

  return null;
}
