import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CHECK_CASH_PERMISSIONS } from "@/features/checks/lib/check-cash";
import { EXPENSE_SOURCE_WRITE } from "@/features/cost-centers/schema";
import { DUE_DATE_PERMISSIONS } from "@/features/dashboard/schema";
import { HR_CASH_PERMISSIONS } from "@/features/hr/lib/hr-cash";
import { LOAN_CASH_PERMISSIONS } from "@/features/loans/lib/loan-cash";
import { TREASURY_PERMISSIONS, type Permission } from "@/lib/auth/permissions";

const { AI_ACTIONS } = await import("./catalog");

// A tool's declared permission must be the gate of the server action it
// wraps: looser and the tool is offered to a user the action refuses (the
// getLoans case), stricter and the assistant hides what the page shows (the
// proposeRecategorizeExpense case). Each row names the action, the gate it
// checks and the text of that gate in its source; the test reads the source
// so a changed gate fails here until the row (and the tool) follow.

type Gate = { all: readonly Permission[] } | { anyOf: readonly Permission[] };

type Row = {
  tool: string;
  /** The wrapped action: its file and exported function. */
  file: string;
  fn: string;
  gate: Gate;
  /** Text the action's body must contain: the quoted permissions by
   *  default, or the constant it checks. */
  token?: string;
};

const all = (...p: Permission[]): Gate => ({ all: p });

const PARITY: Row[] = [
  // Tesorería
  {
    tool: "getCashFlow",
    file: "features/treasury/actions/cash-flow-actions.ts",
    fn: "getCashFlowAction",
    gate: { all: TREASURY_PERMISSIONS },
    token: "TREASURY_PERMISSIONS",
  },
  {
    tool: "getTreasurySummary",
    file: "features/treasury/actions/treasury-actions.ts",
    fn: "getTreasurySummaryAction",
    gate: { all: TREASURY_PERMISSIONS },
    token: "TREASURY_PERMISSIONS",
  },
  {
    tool: "getLoans",
    file: "features/loans/actions/loans-actions.ts",
    fn: "listLoansAction",
    gate: { all: TREASURY_PERMISSIONS },
    token: "TREASURY_PERMISSIONS",
  },
  {
    tool: "getLoanDetail",
    file: "features/loans/actions/loans-actions.ts",
    fn: "getLoanAction",
    gate: { all: TREASURY_PERMISSIONS },
    token: "TREASURY_PERMISSIONS",
  },
  {
    tool: "getUpcomingDueDates",
    file: "features/dashboard/actions/dashboard-actions.ts",
    fn: "getDashboardDueDatesAction",
    gate: { anyOf: DUE_DATE_PERMISSIONS },
    token: "DUE_DATE_PERMISSIONS",
  },
  {
    tool: "getBankReconciliation",
    file: "features/bank-reconciliation/actions/reconciliation-actions.ts",
    fn: "getReconciliationAction",
    gate: all("transactions:read"),
  },
  {
    tool: "getBankReconciliation",
    file: "features/bank-reconciliation/actions/reconciliation-actions.ts",
    fn: "listReconciliationAccountsAction",
    gate: all("transactions:read"),
  },
  // Ventas / compras
  {
    tool: "getClientAccount",
    file: "features/clients/actions/account-actions.ts",
    fn: "getClientAccountAction",
    gate: all("clients:read"),
  },
  {
    tool: "getSupplierAccount",
    file: "features/suppliers/actions/account-actions.ts",
    fn: "getSupplierAccountAction",
    gate: all("suppliers:read"),
  },
  {
    tool: "getClientTariffs",
    file: "features/client-tariffs/actions/client-tariffs-actions.ts",
    fn: "listClientTariffsAction",
    gate: all("storage_billing:read"),
  },
  {
    tool: "getFreightTariffs",
    file: "features/freight-tariffs/actions/freight-tariffs-actions.ts",
    fn: "listFreightTariffsAction",
    gate: all("freight_tariffs:read"),
  },
  {
    tool: "getInvoiceDetail",
    file: "features/invoices/actions/invoices-actions.ts",
    fn: "getInvoiceDetailAction",
    gate: all("invoices:read"),
  },
  {
    tool: "getReceiptDetail",
    file: "features/receipts/actions/receipts-actions.ts",
    fn: "getReceiptByIdAction",
    gate: all("receipts:read"),
  },
  {
    tool: "getPaymentOrderDetail",
    file: "features/payment-orders/actions/payment-orders-actions.ts",
    fn: "getPaymentOrderByIdAction",
    gate: all("payment_orders:read"),
  },
  {
    tool: "getPurchaseInvoiceDetail",
    file: "features/purchase-invoices/actions/purchase-invoices-actions.ts",
    fn: "getPurchaseInvoiceByIdAction",
    gate: all("purchase_invoices:read"),
  },
  {
    tool: "getPurchaseInvoiceDetail",
    file: "features/purchase-invoices/actions/purchase-invoices-actions.ts",
    fn: "getPurchaseInvoiceItemsAction",
    gate: all("purchase_invoices:read"),
  },
  {
    tool: "getPurchaseInvoiceDetail",
    file: "features/purchase-invoices/actions/purchase-invoices-actions.ts",
    fn: "getPurchaseInvoiceAllocationsAction",
    gate: all("purchase_invoices:read"),
  },
  {
    tool: "getPurchaseInvoiceDetail",
    file: "features/purchase-invoices/actions/impute-remitos-actions.ts",
    fn: "getPurchaseImputationsAction",
    gate: all("purchase_invoices:read"),
  },
  {
    tool: "getArcaReceivedVouchers",
    file: "features/purchase-invoices/actions/arca-received-actions.ts",
    fn: "listReceivedVouchersAction",
    gate: all("purchase_invoices:write"),
  },
  {
    tool: "getArcaPurchaseReconciliation",
    file: "features/purchase-invoices/actions/arca-reconciliation-actions.ts",
    fn: "getArcaReconciliationMonthsAction",
    gate: all("purchase_invoices:write"),
  },
  {
    tool: "proposeRecategorizeExpense",
    file: "features/cost-centers/actions/recategorize-actions.ts",
    fn: "recategorizeExpenseAction",
    gate: { anyOf: Object.values(EXPENSE_SOURCE_WRITE) },
    token: "EXPENSE_SOURCE_WRITE[",
  },
  // RRHH proposals: the form's write gate (the token) plus the hr:read of
  // prepare's employee search.
  {
    tool: "proposeCreateEmployee",
    file: "features/hr/actions/employees-actions.ts",
    fn: "createEmployeeAction",
    gate: all("hr:write", "hr:read"),
    token: '"hr:write"',
  },
  {
    tool: "proposeUpdateEmployee",
    file: "features/hr/actions/employees-actions.ts",
    fn: "updateEmployeeAction",
    gate: all("hr:write", "hr:read"),
    token: '"hr:write"',
  },
  {
    tool: "proposePayrollPayment",
    file: "features/hr/actions/payroll-payments-actions.ts",
    fn: "createPayrollPaymentAction",
    gate: all(...HR_CASH_PERMISSIONS, "hr:read", "accounts:read"),
    token: "HR_CASH_PERMISSIONS",
  },
  {
    tool: "proposePayrollPayment",
    file: "features/hr/actions/payroll-payments-actions.ts",
    fn: "bulkCreatePayrollPaymentsAction",
    gate: all(...HR_CASH_PERMISSIONS, "hr:read", "accounts:read"),
    token: "HR_CASH_PERMISSIONS",
  },
  {
    tool: "proposeEmployeeAccountCash",
    file: "features/hr/actions/employee-account-actions.ts",
    fn: "recordEmployeeAccountCashAction",
    gate: all(...HR_CASH_PERMISSIONS, "hr:read", "accounts:read"),
    token: "HR_CASH_PERMISSIONS",
  },
  {
    tool: "proposeEmployeeAccountMovement",
    file: "features/hr/actions/employee-account-actions.ts",
    fn: "createManualMovementAction",
    gate: all("hr:write", "hr:read"),
    token: '"hr:write"',
  },
  {
    tool: "getLeavesByRange",
    file: "features/hr/actions/vacations-actions.ts",
    fn: "listLeavesByRangeAction",
    gate: all("hr:read"),
  },
  {
    tool: "proposeAttendance",
    file: "features/hr/actions/attendance-actions.ts",
    fn: "upsertAttendanceRecordAction",
    gate: all("hr:write", "hr:read"),
    token: '"hr:write"',
  },
  {
    tool: "proposeLoanInstallmentPayment",
    file: "features/loans/actions/loans-actions.ts",
    fn: "payInstallmentAction",
    gate: all(...LOAN_CASH_PERMISSIONS, ...TREASURY_PERMISSIONS),
    token: "LOAN_CASH_PERMISSIONS",
  },
  {
    tool: "proposeInvoiceEmail",
    file: "features/invoices/actions/send-invoice-email.ts",
    fn: "sendInvoiceByEmailAction",
    gate: all("email:send", "invoices:read"),
  },
  {
    tool: "proposeReceiptEmail",
    file: "features/receipts/actions/send-receipt-email.ts",
    fn: "sendReceiptByEmailAction",
    gate: all("email:send", "receipts:read"),
  },
  // Flota / depósito
  // Fleet proposals: the form's gate alone; a plate, driver or client is
  // resolved only when the user can read that module. proposeShipmentStatus
  // also needs shipments:read (it reads the carga), so it has no row.
  {
    tool: "proposeTrip",
    file: "features/trips/actions/trips-actions.ts",
    fn: "createTripAction",
    gate: all("trips:write"),
  },
  {
    tool: "proposeShipment",
    file: "features/shipments/actions/shipments-actions.ts",
    fn: "createShipmentAction",
    gate: all("shipments:write"),
  },
  {
    tool: "proposeFuelLoad",
    file: "features/fuel/actions/fuel-actions.ts",
    fn: "createFuelLoadAction",
    gate: all("fuel:write"),
  },
  {
    tool: "proposeMaintenance",
    file: "features/maintenance/actions/maintenance-actions.ts",
    fn: "createMaintenanceAction",
    gate: all("maintenance:write"),
  },
  {
    tool: "getTrips",
    file: "features/trips/actions/trips-actions.ts",
    fn: "listTripsAction",
    gate: all("trips:read"),
  },
  {
    tool: "getTripDetail",
    file: "features/trips/actions/trips-actions.ts",
    fn: "getTripAction",
    gate: all("trips:read"),
  },
  {
    tool: "getVehicleUsage",
    file: "features/trips/actions/trips-actions.ts",
    fn: "listTripsAction",
    gate: all("trips:read"),
  },
  {
    tool: "getVehicleUsage",
    file: "features/fleet-reports/actions/activity-actions.ts",
    fn: "getVehicleActivityAction",
    gate: all("trips:read"),
  },
  {
    tool: "getFuelLoads",
    file: "features/fuel/actions/fuel-actions.ts",
    fn: "listFuelLoadsAction",
    gate: all("fuel:read"),
  },
  {
    tool: "getMaintenance",
    file: "features/maintenance/actions/maintenance-actions.ts",
    fn: "listMaintenanceAction",
    gate: all("maintenance:read"),
  },
  {
    tool: "getVehicleKm",
    file: "features/vehicle-km/actions/vehicle-km-actions.ts",
    fn: "getVehicleKmRangeAction",
    gate: all("fleet_km:read"),
  },
  {
    tool: "getVehicles",
    file: "features/vehicles/actions/vehicles-actions.ts",
    fn: "listVehiclesAction",
    gate: all("vehicles:read"),
  },
  {
    tool: "getDrivers",
    file: "features/drivers/actions/drivers-actions.ts",
    fn: "listDriversAction",
    gate: all("drivers:read"),
  },
  {
    tool: "getShipments",
    file: "features/shipments/actions/shipments-actions.ts",
    fn: "listShipmentsAction",
    gate: all("shipments:read"),
  },
  {
    tool: "getShipmentsSummary",
    file: "features/shipments/actions/shipments-summary-actions.ts",
    fn: "getShipmentsSummaryAction",
    gate: all("shipments:read"),
  },
  {
    tool: "getPallets",
    file: "features/pallets/actions/pallets-actions.ts",
    fn: "listPalletsAction",
    gate: all("pallets:read"),
  },
  {
    tool: "getPalletsSummary",
    file: "features/pallets/actions/pallets-summary-actions.ts",
    fn: "getPalletsSummaryAction",
    gate: all("pallets:read"),
  },
  // General / admin
  {
    tool: "getDocumentExtractions",
    file: "features/ai/document/actions.ts",
    fn: "listExtractionsAction",
    gate: all("ai:read"),
  },
  {
    tool: "getAiWorkflows",
    file: "features/ai/workflows/actions.ts",
    fn: "listAiWorkflowsAction",
    gate: all("ai:chat"),
  },
  {
    tool: "searchFiles",
    file: "features/files/actions/hub-actions.ts",
    fn: "listHubFilesAction",
    gate: all("files:read"),
  },
  {
    tool: "getUsers",
    file: "features/admin-users/actions/users-actions.ts",
    fn: "listUsersAction",
    gate: all("users:read"),
  },
  {
    tool: "getImportRuns",
    file: "features/imports/actions/import-actions.ts",
    fn: "listImportRunsAction",
    gate: all("imports:read"),
  },
  {
    tool: "getBackups",
    file: "features/backups/actions/backups-actions.ts",
    fn: "listBackupsAction",
    gate: all("audit:read"),
  },
];

/** The body of `export async function fn(` up to the next top-level export. */
function actionBody(file: string, fn: string): string {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  const start = source.indexOf(`export async function ${fn}(`);
  if (start < 0) throw new Error(`${fn} not found in ${file}`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

const sorted = (p: readonly Permission[]) => [...p].sort();

describe("read tool permission = wrapped action's gate", () => {
  const byName = new Map(AI_ACTIONS.map((a) => [a.name, a]));

  it.each(PARITY)("$tool ↔ $fn", (row) => {
    const tool = byName.get(row.tool);
    expect(tool, `${row.tool} is not in the catalogue`).toBeDefined();
    if (!tool) return;

    // The action still checks that gate.
    const body = actionBody(row.file, row.fn);
    const tokens =
      row.token !== undefined
        ? [row.token]
        : ("all" in row.gate ? row.gate.all : row.gate.anyOf).map(
            (p) => `"${p}"`,
          );
    for (const token of tokens) {
      expect(body, `${row.fn} no longer checks ${token}`).toContain(token);
    }

    // The tool declares that gate: every permission it needs, no more.
    if ("all" in row.gate) {
      expect(sorted(tool.permissions)).toEqual(sorted(row.gate.all));
      expect(tool.anyOfPermissions).toEqual([]);
    } else {
      expect(tool.permissions).toEqual([]);
      expect(sorted(tool.anyOfPermissions)).toEqual(sorted(row.gate.anyOf));
    }
  });
});

// A proposal's accept runs the same command as the page's server action, so
// it needs at least that action's gate (plus the reads `prepare` uses): the
// tool is never offered to a user the page would refuse.
const PROPOSAL_PARITY: Row[] = [
  {
    tool: "proposeReceipt",
    file: "features/receipts/actions/receipts-actions.ts",
    fn: "createReceiptAction",
    gate: all("receipts:write"),
  },
  {
    tool: "proposePaymentOrder",
    file: "features/payment-orders/actions/payment-orders-actions.ts",
    fn: "createPaymentOrderAction",
    gate: all("payment_orders:write"),
  },
  {
    tool: "proposeCashMovement",
    file: "features/transactions/actions/transactions-actions.ts",
    fn: "createTransactionAction",
    gate: all("transactions:write"),
  },
  {
    tool: "proposeTransfer",
    file: "features/transactions/actions/transactions-actions.ts",
    fn: "createTransferAction",
    gate: all("transactions:write"),
  },
  {
    tool: "proposeManualCheck",
    file: "features/checks/actions/checks-actions.ts",
    fn: "createCheckAction",
    gate: all(...CHECK_CASH_PERMISSIONS),
    token: "CHECK_CASH_PERMISSIONS",
  },
  {
    tool: "proposeCheckDeposit",
    file: "features/checks/actions/checks-actions.ts",
    fn: "depositCheckAction",
    gate: all(...CHECK_CASH_PERMISSIONS),
    token: "CHECK_CASH_PERMISSIONS",
  },
  {
    tool: "proposeIssuedCheck",
    file: "features/issued-checks/actions/issued-checks-actions.ts",
    fn: "createIssuedCheckAction",
    gate: all("issued_checks:write"),
  },
  {
    tool: "proposePurchaseInvoice",
    file: "features/purchase-invoices/actions/purchase-invoices-actions.ts",
    fn: "createPurchaseInvoiceAction",
    gate: all("purchase_invoices:write"),
  },
  {
    tool: "proposeArcaPurchase",
    file: "features/purchase-invoices/actions/arca-received-actions.ts",
    fn: "createPurchaseInvoiceFromReceivedAction",
    gate: all("purchase_invoices:write"),
  },
  {
    tool: "proposeSupplier",
    file: "features/suppliers/actions/suppliers-actions.ts",
    fn: "createSupplierAction",
    gate: all("suppliers:write"),
  },
  {
    tool: "proposeSupplierUpdate",
    file: "features/suppliers/actions/suppliers-actions.ts",
    fn: "updateSupplierAction",
    gate: all("suppliers:write"),
  },
  {
    tool: "proposeTaxDocument",
    file: "features/taxes/actions/tax-documents-actions.ts",
    fn: "createTaxDocumentAction",
    gate: all("taxes:write"),
  },
  {
    tool: "proposeTaxPayment",
    file: "features/taxes/actions/tax-documents-actions.ts",
    fn: "payTaxDocumentAction",
    gate: all("taxes:write", "transactions:write"),
  },
  {
    tool: "proposeFreightSettlementConfirm",
    file: "features/freight-settlements/actions/freight-settlements-actions.ts",
    fn: "confirmFreightSettlementAction",
    gate: all("invoices:issue"),
  },
  {
    tool: "proposeStorageInvoice",
    file: "features/storage-billing/actions/billing-actions.ts",
    fn: "invoiceStorageAction",
    gate: all("storage_billing:issue", "invoices:issue"),
  },
  {
    tool: "proposeDriverSettlement",
    file: "features/driver-settlements/actions/driver-settlements-actions.ts",
    fn: "saveDriverSettlementAction",
    gate: all("receipts:write"),
  },
  {
    tool: "proposeDriverSettlementConfirm",
    file: "features/driver-settlements/actions/driver-settlements-actions.ts",
    fn: "confirmDriverSettlementAction",
    gate: all("receipts:write"),
  },
  // Charging the driver also needs CHARGE_DRIVER_PERMISSIONS, which the
  // proposal checks on the record (prepare and accept), as the action does.
  {
    tool: "proposeDriverSettlementDifference",
    file: "features/driver-settlements/actions/driver-settlements-actions.ts",
    fn: "postDriverSettlementDifferenceAction",
    gate: all("receipts:write"),
  },
];

describe("proposal permission covers the page action's gate", () => {
  const byName = new Map(AI_ACTIONS.map((a) => [a.name, a]));

  it.each(PROPOSAL_PARITY)("$tool ⊇ $fn", (row) => {
    const tool = byName.get(row.tool);
    expect(tool, `${row.tool} is not in the catalogue`).toBeDefined();
    if (!tool || !("all" in row.gate)) return;
    const body = actionBody(row.file, row.fn);
    const tokens = row.token ? [row.token] : row.gate.all.map((p) => `"${p}"`);
    for (const token of tokens) {
      expect(body, `${row.fn} no longer checks ${token}`).toContain(token);
    }
    for (const p of row.gate.all) expect(tool.permissions).toContain(p);
  });
});
