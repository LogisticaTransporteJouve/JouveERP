import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXPENSE_SOURCE_WRITE } from "@/features/cost-centers/schema";
import { DUE_DATE_PERMISSIONS } from "@/features/dashboard/schema";
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
    tool: "proposeRecategorizeExpense",
    file: "features/cost-centers/actions/recategorize-actions.ts",
    fn: "recategorizeExpenseAction",
    gate: { anyOf: Object.values(EXPENSE_SOURCE_WRITE) },
    token: "EXPENSE_SOURCE_WRITE[",
  },
  // Flota / depósito
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
    fn: "getVehicleKmMonthAction",
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
