import type { PayrollPaymentMethod } from "../payroll-schema";

// How an entry's total splits between bank transfer and cash (decision D5):
// the transfer matches the liquidador's receipt net, less the garnishment and
// the discounts; the rest of the total goes in cash. A method suggestion only:
// the channel of each payment (books or management) is the database's.

type SplitFields = {
  recibo_neto: number | null;
  sueldo_neto: number;
  embargo: number;
  deudas: number;
  telefono: number;
  total_a_pagar: number;
};

type PaidFields = SplitFields & {
  saldo: number;
  paid_transferencia: number;
  paid_efectivo: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Agreed salary minus the receipt net ("Otros"); null without a receipt. */
export function payrollOtros(e: SplitFields): number | null {
  if (e.recibo_neto === null) return null;
  return round2(e.sueldo_neto - e.recibo_neto);
}

/** Suggested split of the total; null without a receipt net. */
export function suggestedSplit(
  e: SplitFields,
): { transferencia: number; efectivo: number } | null {
  if (e.recibo_neto === null) return null;
  const total = Math.max(e.total_a_pagar, 0);
  // Transfer suggestion, not the books' share (payroll_fiscal_share): deudas
  // and teléfono net out of what is sent by bank; the books still carry the
  // full recibo − embargo (the recibo gap is posted at planilla close). Merge
  // with the share if the owner decides the transfer must equal it.
  const transfer = Math.min(
    Math.max(e.recibo_neto - e.embargo - e.deudas - e.telefono, 0),
    total,
  );
  return {
    transferencia: round2(transfer),
    efectivo: round2(total - transfer),
  };
}

/**
 * Amount to suggest for a new payment by `method`: what is left of that
 * method's share after its earlier payments, never above the balance.
 * Without a receipt net, the whole balance.
 */
export function suggestedPayment(
  e: PaidFields,
  method: PayrollPaymentMethod,
): number {
  const balance = Math.max(e.saldo, 0);
  const split = suggestedSplit(e);
  if (!split) return round2(balance);
  const pending =
    method === "transferencia"
      ? split.transferencia - e.paid_transferencia
      : split.efectivo - e.paid_efectivo;
  return round2(Math.min(Math.max(pending, 0), balance));
}
