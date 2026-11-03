import "server-only";

import { getSupplierAccountAction } from "@/features/suppliers/actions/account-actions";
import {
  SUPPLIER_MOVEMENT_KIND_LABEL,
  formatSupplierMovementNumber,
} from "@/features/suppliers/lib/account-movement-format";

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
        type: SUPPLIER_MOVEMENT_KIND_LABEL[m.kind] ?? m.kind,
        document: formatSupplierMovementNumber(m),
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
