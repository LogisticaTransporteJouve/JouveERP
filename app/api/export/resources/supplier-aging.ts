import "server-only";

import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import { SUPPLIER_AGING_PERMISSIONS } from "@/lib/auth/permissions";

import { agingExport, type Exporter } from "../shared";

export const supplierAging: Exporter = {
  permission: SUPPLIER_AGING_PERMISSIONS,
  // Snapshot: aging buckets reflect "today". The date range is ignored.
  load: async () => {
    const res = await getSupplierAgingAction();
    if (!res.ok) throw new Error(res.error);
    return agingExport(res.data, {
      title: "Aging de proveedores",
      subtitle: "Deudas con proveedores por antigüedad",
      partyHeader: "Proveedor",
      fileName: "aging-proveedores",
    });
  },
};
