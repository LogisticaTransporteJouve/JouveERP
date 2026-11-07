import { redirect } from "next/navigation";

import { ARCA_RECONCILIATION_PURCHASES_HREF } from "@/features/purchase-invoices/lib/arca-reconciliation";

// The Conciliación con ARCA lives in Admin › Puntos de venta, Compras tab.
export default function ArcaReconciliationPage() {
  redirect(ARCA_RECONCILIATION_PURCHASES_HREF);
}
