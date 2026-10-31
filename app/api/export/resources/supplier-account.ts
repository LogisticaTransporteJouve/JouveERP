import "server-only";

import {
  getSupplierAccountAction,
  type SupplierAccountMovement,
} from "@/features/suppliers/actions/account-actions";
import { formatInvoiceNumber } from "@/features/purchase-invoices/schema";

import {
  ACCOUNT_COLUMNS,
  dateCell,
  inRange,
  moneyCell,
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
    const supplierId = params.get("supplierId");
    if (!supplierId) throw new Error("Missing supplier.");
    const res = await getSupplierAccountAction(supplierId);
    if (!res.ok) throw new Error(res.error);
    const movements = res.data.movements.filter((m) =>
      inRange(m.movement_date, range),
    );
    let totalDebe = 0;
    let totalHaber = 0;
    const rows = movements.map((m) => {
      const debe = m.signed_amount > 0 ? m.signed_amount : 0;
      const haber = m.signed_amount < 0 ? -m.signed_amount : 0;
      totalDebe += debe;
      totalHaber += haber;
      return [
        dateCell(m.movement_date),
        SUPPLIER_KIND_LABEL[m.kind] ?? m.kind,
        supplierDoc(m),
        debe ? moneyCell(debe) : "",
        haber ? moneyCell(haber) : "",
        moneyCell(m.balance),
      ];
    });
    const finalBalance = movements.length
      ? movements[movements.length - 1]!.balance
      : res.data.balance;
    return {
      title: "Cuenta corriente — Proveedor",
      subtitle: params.get("name") ?? undefined,
      columns: ACCOUNT_COLUMNS,
      rows,
      totalsRow: [
        "",
        "",
        "Totales",
        moneyCell(totalDebe),
        moneyCell(totalHaber),
        moneyCell(finalBalance),
      ],
      fileName: withSlug("cuenta-corriente-proveedor", params.get("name")),
    };
  },
};
