"use client";

import { Label } from "@/components/ui/label";
import { PurchaseInvoiceLinkPicker } from "@/features/purchase-invoices/components/purchase-invoice-link-picker";
import { ExpenseTransactionPicker } from "@/features/transactions/components/expense-transaction-picker";
import type { CostVoucherAccess } from "@/lib/cost-vouchers";

export type CostVoucherField = "purchase_invoice_id" | "transaction_id";

/**
 * The voucher of a fleet cost: the purchase invoice that books it and the
 * movement that paid it. Each picker shows only to who can read its source;
 * without either, the cost stays "sin comprobante" in the fleet report.
 */
export function CostVoucherFields({
  access,
  purchaseInvoiceId,
  transactionId,
  aroundDate,
  onChange,
  disabled,
}: {
  access: CostVoucherAccess;
  purchaseInvoiceId: string;
  transactionId: string;
  aroundDate: string;
  onChange: (field: CostVoucherField, value: string) => void;
  disabled?: boolean;
}) {
  if (!access.purchaseInvoices && !access.transactions) return null;
  return (
    <div className="space-y-3">
      {access.purchaseInvoices && (
        <div className="space-y-2">
          <Label>Factura de compra (opcional)</Label>
          <PurchaseInvoiceLinkPicker
            value={purchaseInvoiceId || null}
            onChange={(id) => onChange("purchase_invoice_id", id ?? "")}
            disabled={disabled}
          />
        </div>
      )}
      {access.transactions && (
        <div className="space-y-2">
          <Label>Movimiento de pago (opcional)</Label>
          <ExpenseTransactionPicker
            value={transactionId || null}
            onChange={(id) => onChange("transaction_id", id ?? "")}
            aroundDate={aroundDate}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
