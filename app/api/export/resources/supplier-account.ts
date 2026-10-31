import "server-only";

import {
  getSupplierAccountAction,
  type SupplierAccountMovement,
} from "@/features/suppliers/actions/account-actions";
import { formatInvoiceNumber } from "@/features/purchase-invoices/schema";

import {
  ACCOUNT_COLUMNS,
  accountStatementTable,
  exportScope,
  ExportInputError,
  inRange,
  scopedSubtitle,
  type Exporter,
  withSlug,
} from "../shared";

const SUPPLIER_KIND_LABEL: Record<string, string> = {
  factura: "Factura",
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
  payment_order: "Orden de Pago",
  opening_balance: "Ajuste de saldo",
};

function supplierDoc(m: SupplierAccountMovement): string {
  if (m.source_type === "opening_balance") return "—";
  if (!m.punto_venta || !m.numero) return "—";
  if (m.source_type === "payment_order") {
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

export const supplierAccount: Exporter = {
  permission: "suppliers:read",
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const supplierId = params.get("supplierId");
    if (!supplierId) throw new ExportInputError("Missing supplier.");
    const res = await getSupplierAccountAction(supplierId, { isFiscal });
    if (!res.ok) throw new Error(res.error);
    const movements = res.data.movements.filter((m) =>
      inRange(m.movement_date, range),
    );
    // Under a scope rows carry no running balance: the totals are the scope's.
    const table = accountStatementTable(
      movements.map((m) => ({
        date: m.movement_date,
        type: SUPPLIER_KIND_LABEL[m.kind] ?? m.kind,
        document: supplierDoc(m),
        currency: m.currency,
        debe: m.signed_amount > 0 ? m.signed_amount : 0,
        haber: m.signed_amount < 0 ? -m.signed_amount : 0,
        balance: m.balance,
      })),
      res.data.balances,
    );
    return {
      title: "Cuenta corriente — Proveedor",
      subtitle: scopedSubtitle(scope, params.get("name") ?? undefined),
      columns: ACCOUNT_COLUMNS,
      ...table,
      fileName: withSlug("cuenta-corriente-proveedor", params.get("name")),
    };
  },
};
