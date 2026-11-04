import { ACCOUNTS_UNAVAILABLE_MESSAGE } from "@/features/accounts/lib/accounts-unavailable";
import {
  CHECK_CASH_DENIED_REASON,
  CHECK_CASH_PERMISSIONS,
} from "@/features/checks/lib/check-cash";
import { PAYMENT_ORDER_FORM_PERMISSIONS } from "@/features/payment-orders/lib/payment-order-form";
import { RECEIPT_FORM_PERMISSIONS } from "@/features/receipts/lib/receipt-form";
import {
  type Access,
  type Permission,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";

type Gate = {
  /** The write the create action checks, and why it is off without it. */
  write: Permission;
  denied: string;
  /** What the form needs on top (cash movements, picking an account). */
  extra?: readonly { needs: readonly Permission[]; denied: string }[];
};

const PICKS_ACCOUNT = {
  needs: ["accounts:read"],
  denied: ACCOUNTS_UNAVAILABLE_MESSAGE,
} as const;

const GATES: Partial<Record<string, Gate>> = {
  check: {
    write: "cheques:write",
    denied: "No tenés permiso para cargar cheques.",
    extra: [
      { needs: CHECK_CASH_PERMISSIONS, denied: CHECK_CASH_DENIED_REASON },
      PICKS_ACCOUNT,
    ],
  },
  receipt: {
    write: "receipts:write",
    denied: "No tenés permiso para cargar recibos.",
    extra: [
      { needs: RECEIPT_FORM_PERMISSIONS, denied: ACCOUNTS_UNAVAILABLE_MESSAGE },
    ],
  },
  payment_order: {
    write: "payment_orders:write",
    denied: "No tenés permiso para cargar órdenes de pago.",
    extra: [
      {
        needs: PAYMENT_ORDER_FORM_PERMISSIONS,
        denied: ACCOUNTS_UNAVAILABLE_MESSAGE,
      },
    ],
  },
  sales_invoice: {
    write: "invoices:issue",
    denied: "No tenés permiso para emitir facturas.",
  },
  purchase_invoice: {
    write: "purchase_invoices:write",
    denied: "No tenés permiso para cargar compras.",
  },
  credit_debit_note: {
    write: "purchase_invoices:write",
    denied: "No tenés permiso para cargar compras.",
  },
};

/** Why the review cannot offer the create action for a scanned `kind`, or
 *  null when it can (or the kind has none). It mirrors the gate of that
 *  kind's create action, plus `accounts:read` where the form picks an
 *  account, so a button is never offered that the server refuses or that
 *  takes the page down. */
export function reviewCreateDeniedReason(
  access: Access,
  kind: string | null,
): string | null {
  const gate = kind ? GATES[kind] : undefined;
  if (!gate) return null;
  if (!userCan(access, gate.write)) return gate.denied;
  for (const { needs, denied } of gate.extra ?? []) {
    if (!userCanAll(access, needs)) return denied;
  }
  return null;
}
