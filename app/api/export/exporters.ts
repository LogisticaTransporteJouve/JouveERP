import "server-only";

import { accounts } from "./resources/accounts";
import { aging } from "./resources/aging";
import { checks } from "./resources/checks";
import { clientAccount } from "./resources/client-account";
import { clients } from "./resources/clients";
import { costCenters } from "./resources/cost-centers";
import { drivers } from "./resources/drivers";
import { employees } from "./resources/employees";
import { exchangeRates } from "./resources/exchange-rates";
import { fleetDocuments } from "./resources/fleet-documents";
import { fuel } from "./resources/fuel";
import { invoices } from "./resources/invoices";
import { issuedChecks } from "./resources/issued-checks";
import { maintenance } from "./resources/maintenance";
import { pallets } from "./resources/pallets";
import { paymentOrders } from "./resources/payment-orders";
import { products } from "./resources/products";
import { purchaseInvoices } from "./resources/purchase-invoices";
import { receipts } from "./resources/receipts";
import { recurringPayments } from "./resources/recurring-payments";
import { storageTariffs } from "./resources/storage-tariffs";
import { supplierAccount } from "./resources/supplier-account";
import { supplierAging } from "./resources/supplier-aging";
import { supplierCategories } from "./resources/supplier-categories";
import { suppliers } from "./resources/suppliers";
import { transactions } from "./resources/transactions";
import { vehicles } from "./resources/vehicles";
import { warehouses } from "./resources/warehouses";
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
  clients,
  suppliers,
  products,
  warehouses,
  pallets,
  drivers,
  vehicles,
  fuel,
  maintenance,
  "fleet-documents": fleetDocuments,
  "cost-centers": costCenters,
  "exchange-rates": exchangeRates,
  "storage-tariffs": storageTariffs,
  "recurring-payments": recurringPayments,
  "supplier-categories": supplierCategories,
  accounts,
  employees,
  aging,
  "supplier-aging": supplierAging,
};
