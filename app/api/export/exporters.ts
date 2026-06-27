import "server-only";

import { checks } from "./resources/checks";
import { clientAccount } from "./resources/client-account";
import { invoices } from "./resources/invoices";
import { issuedChecks } from "./resources/issued-checks";
import { paymentOrders } from "./resources/payment-orders";
import { purchaseInvoices } from "./resources/purchase-invoices";
import { receipts } from "./resources/receipts";
import { supplierAccount } from "./resources/supplier-account";
import { transactions } from "./resources/transactions";
import type { Exporter } from "./shared";

export type { ExportRange } from "./shared";

// Registry: maps an export resource id to its Exporter. Each table page hits
// /api/export/<resource>. Add a new table by dropping a file in ./resources/
// and registering it here.
export const EXPORTERS: Record<string, Exporter> = {
  "client-account": clientAccount,
  "supplier-account": supplierAccount,
  invoices,
  receipts,
  "payment-orders": paymentOrders,
  transactions,
  "purchase-invoices": purchaseInvoices,
  checks,
  "issued-checks": issuedChecks,
};
