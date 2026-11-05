import {
  amountToInput,
  COTIZACION_DECIMALS,
  parseArAmount,
} from "@/lib/format";

/** The currency fields an NC/ND takes from the origin just picked: the
 *  origin's currency (guard_purchase_invoice_origin refuses another one) and,
 *  in a foreign one, the cotización already typed for it or else the
 *  origin's. */
export function originCurrencyFields(
  origin: { moneda: string; cotizacion: number },
  current: { moneda: string; cotizacion: string },
): { moneda: string; cotizacion: string } {
  if (origin.moneda === "PES") return { moneda: "PES", cotizacion: "1" };
  const typed = parseArAmount(current.cotizacion) ?? 0;
  if (current.moneda === origin.moneda && typed > 1) {
    return { moneda: origin.moneda, cotizacion: current.cotizacion };
  }
  return {
    moneda: origin.moneda,
    cotizacion: amountToInput(origin.cotizacion, COTIZACION_DECIMALS),
  };
}
