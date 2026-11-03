import { formatInvoiceNumber } from "@/features/purchase-invoices/schema";

import type { SupplierAccountMovement } from "../actions/account-actions";

/** Label of a supplier statement row by its `kind` (the tab and the export). */
export const SUPPLIER_MOVEMENT_KIND_LABEL: Record<string, string> = {
  factura: "Factura",
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
  payment_order: "Orden de Pago",
  opening_balance: "Ajuste de saldo",
  rejected_check: "Cheque rechazado",
};

/** Document number of a supplier statement row. A bounced check carries the
 *  number of the OP that delivered it. */
export function formatSupplierMovementNumber(
  m: Pick<
    SupplierAccountMovement,
    "source_type" | "kind" | "letter" | "punto_venta" | "numero"
  >,
): string {
  if (m.source_type === "opening_balance") return "—";
  if (!m.punto_venta || !m.numero) return "—";
  if (m.source_type === "payment_order" || m.source_type === "rejected_check") {
    const pos = String(m.punto_venta).padStart(5, "0");
    return `OP${pos}-${String(m.numero).padStart(8, "0")}`;
  }
  return formatInvoiceNumber({
    kind: m.kind,
    letter: m.letter,
    punto_venta: m.punto_venta,
    numero: m.numero,
  });
}
