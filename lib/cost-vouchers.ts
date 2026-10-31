import { z } from "zod";

import { userCan, type Access } from "@/lib/auth/permissions";

// The voucher of a fleet cost (fuel load, maintenance record): the purchase
// invoice that books it and/or the treasury movement that paid it. Both are
// optional; a cost with neither is "sin comprobante" in the fleet report.

const optionalLink = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const CostVoucherShape = {
  purchase_invoice_id: optionalLink,
  transaction_id: optionalLink,
};

export type CostVoucherInput = {
  purchase_invoice_id?: string | null;
  transaction_id?: string | null;
};

/** What the user may see when picking a voucher. */
export type CostVoucherAccess = {
  purchaseInvoices: boolean;
  transactions: boolean;
};

export function costVoucherAccess(access: Access): CostVoucherAccess {
  return {
    purchaseInvoices: userCan(access, "purchase_invoices:read"),
    transactions: userCan(access, "transactions:read"),
  };
}

/** The error when the input sets a link the user cannot see, else null. */
export function costVoucherDenied(
  access: Access,
  input: CostVoucherInput,
): string | null {
  const can = costVoucherAccess(access);
  if (input.purchase_invoice_id !== undefined && !can.purchaseInvoices) {
    return "No tenés permiso para vincular facturas de compra.";
  }
  if (input.transaction_id !== undefined && !can.transactions) {
    return "No tenés permiso para vincular movimientos.";
  }
  return null;
}

/** The voucher columns the input sets (undefined = left as is). */
export function costVoucherPatch(input: CostVoucherInput): CostVoucherInput {
  return {
    ...(input.purchase_invoice_id !== undefined && {
      purchase_invoice_id: input.purchase_invoice_id,
    }),
    ...(input.transaction_id !== undefined && {
      transaction_id: input.transaction_id,
    }),
  };
}
