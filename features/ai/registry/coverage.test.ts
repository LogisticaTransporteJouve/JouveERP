import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ASSISTANT_ITEM, NAV_SECTIONS } from "@/components/layout/nav-items";

const { AI_ACTIONS } = await import("./catalog");

// "Cada módulo tiene su tool de lectura" (docs/ai-cfo.md): every dashboard
// page and nav entry names the registry read tools that answer what it shows,
// or sits in NO_TOOL with the reason it needs none. A new page fails here
// until it is mapped.

const PAGE_TOOLS: Record<string, readonly string[]> = {
  "/dashboard": [
    "getTodayOverview",
    "getUpcomingDueDates",
    "getTreasurySummary",
    "getClientAging",
    "getSupplierAging",
    "getTasks",
  ],
  "/tasks": ["getTasks"],
  "/files": ["searchFiles", "getAttachments"],
  "/ai/tasks": ["getAiWorkflows"],
  "/documentos": ["getDocumentExtractions"],
  // Ventas
  "/clients": ["searchClients", "getClientSalesSummary"],
  "/clients/[id]": ["getClientAccount", "getClientAging", "getClientTariffs"],
  "/invoices": ["getInvoices"],
  "/invoices/[id]": ["getInvoiceDetail"],
  "/receipts": ["getReceipts"],
  "/receipts/[id]": ["getReceiptDetail"],
  "/aging": ["getClientAging", "getClientPaymentBehavior"],
  "/aging/mora": ["getLateInterestCandidates"],
  // Compras
  "/suppliers": ["searchSuppliers", "getSupplierPurchasesSummary"],
  "/suppliers/[id]": ["getSupplierAccount", "getSupplierAging"],
  "/suppliers/categories": ["getSupplierCategories"],
  "/suppliers/categories/[id]": [
    "getSupplierCategories",
    "getSupplierPriceEvolution",
  ],
  "/purchases": ["getPurchaseInvoices"],
  "/purchases/[id]": ["getPurchaseInvoiceDetail"],
  "/purchases/arca": ["getArcaReceivedVouchers"],
  "/payment-orders": ["getPaymentOrders"],
  "/payment-orders/[id]": ["getPaymentOrderDetail"],
  "/aging-suppliers": ["getSupplierAging", "getSupplierUpcomingDues"],
  // Tesorería
  "/treasury": ["getTreasurySummary"],
  "/treasury/cash-flow": ["getCashFlow"],
  "/accounts": ["getAccounts"],
  "/accounts/[id]": ["getAccounts", "getTransactions", "getBankReconciliation"],
  "/transactions": ["getTransactions"],
  "/checks": ["getChecks"],
  "/issued-checks": ["getIssuedChecks"],
  "/recurring-payments": ["getRecurringPayments"],
  "/loans": ["getLoans"],
  "/loans/[id]": ["getLoanDetail"],
  // Contabilidad
  "/accounting/package": ["getMonthlyPackageStatus"],
  "/accounting/chart": ["getChartOfAccounts"],
  "/accounting/journal": ["getJournalEntries"],
  "/accounting/libro-mayor": ["getLedger"],
  "/accounting/libro-iva-ventas": ["getLibroIvaVentas"],
  "/accounting/libro-iva-compras": ["getLibroIvaCompras"],
  "/accounting/balance": [
    "getTrialBalance",
    "getIncomeStatement",
    "getBalanceSheet",
  ],
  "/management": ["getManagementPnL", "getManagementPnLDocuments"],
  "/accounting/cost-centers": ["getCostCenters", "getCostCenterBreakdown"],
  "/taxes": ["getTaxDocuments"],
  "/accounting/inflation": ["getInflationAdjustments"],
  "/accounting/exchange-rates": ["getExchangeRates"],
  // The ejercicio's start month: getIncomeStatement without periodStart
  // reports the ejercicio it covers.
  "/accounting/settings": ["getIncomeStatement"],
  // Flota
  "/drivers": ["getDrivers", "getDriverActivity"],
  "/drivers/[id]": ["getDriverActivity", "getVehicleKm"],
  "/vehicles": ["getVehicles", "getVehicleEconomics", "getVehicleUsage"],
  "/vehicles/[id]": ["getVehicleKm", "getVehicleUsage"],
  "/trips": ["getTrips"],
  "/trips/[id]": ["getTripDetail"],
  "/cargas": ["getShipments", "getShipmentsSummary"],
  "/liquidaciones": ["getFreightSettlements"],
  "/fleet-tariffs": ["getFreightTariffs"],
  "/rendiciones": ["getDriverSettlements"],
  "/fuel": ["getFuelLoads"],
  "/vehicle-km": ["getVehicleKm", "getVehicleUsage"],
  "/maintenance": ["getMaintenance"],
  "/fleet-documents": ["getFleetDocuments"],
  "/fleet-reports": ["getFleetProfitability", "getFleetMargin"],
  // Depósito
  "/warehouses": ["getWarehouses"],
  "/products": ["getProducts"],
  "/pallets": ["getPallets", "getPalletsSummary"],
  "/pallets/trazabilidad": ["getPallets"],
  "/storage-tariffs": ["getStorageTariffs"],
  "/storage-billing": ["getStorageBilling", "getStorageBillingRuns"],
  // RRHH
  "/employees": ["getEmployees", "searchEmployees"],
  "/employees/[id]": [
    "searchEmployees",
    "getSalaryHistory",
    "getEmployeeAccount",
  ],
  "/hr/payroll": ["getPayrollPeriods", "getPayrollSummary"],
  "/hr/payroll/[year]/[month]": ["getPayrollPeriodDetail"],
  "/hr/payroll/sac/[year]/[half]": ["getPayrollPeriodDetail"],
  "/hr/vacations": [
    "getVacationOverview",
    "getLeavesSummary",
    "getLeavesByRange",
  ],
  "/hr/attendance": ["getAttendance", "getAttendanceSummary"],
  "/hr/attendance/[year]/[month]": ["getAttendance", "getAttendanceSummary"],
  "/hr/document-expirations": ["getExpiringDocuments"],
  // Administración
  "/admin/users": ["getUsers"],
  "/admin/afip/puntos-de-venta": [
    "getAfipStatus",
    "getArcaPurchaseReconciliation",
  ],
  "/admin/imports": ["getImportRuns"],
  "/admin/audit": ["getAuditEvents"],
  "/admin/backups": ["getBackups"],
};

/** Pages with no read tool, and why. */
const NO_TOOL: Record<string, string> = {
  // Card statements are read here and paid from the bank statement; their
  // movements are ordinary expenses and advances the treasury tools read.
  "/card-statements": "card statements, paid as treasury movements",
  // The assistant itself.
  "/ai": "the chat with the assistant",
  // Snapshots of earlier tool results, re-run with the tool that made them.
  "/ai/pinned": "pinned results of other tools",
  // Conversations between people, not business records.
  "/chat": "internal team chat",
  "/chat/[channelId]": "internal team chat",
  // The user's own name, avatar and password.
  "/profile": "the user's own profile",
  // A developer preview of a sample PDF; it holds no data.
  "/admin/afip/preview-pdf": "PDF preview tool",
  "/purchases/arca/reconciliation":
    "redirects to /admin/afip/puntos-de-venta (Compras tab)",
  // Which service users are set and whether they sign in: credentials, not
  // business data for the assistant.
  "/admin/accesos": "service users (credentials)",
  // Its read, verifyCuitAction, calls AFIP and writes padron_cache: the
  // ESLint fence lets only read actions cross features, so a tool needs a
  // read action in features/clients first.
  "/admin/padron": "AFIP padrón lookup (no read action yet)",
};

const DASHBOARD = path.join(process.cwd(), "app", "(dashboard)");

function pageRoutes(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return pageRoutes(path.join(dir, entry.name), `${prefix}/${entry.name}`);
    }
    return entry.name === "page.tsx" ? [prefix || "/"] : [];
  });
}

const ROUTES = pageRoutes(DASHBOARD).sort();
const NAV_HREFS = [
  ASSISTANT_ITEM.href,
  "/profile",
  ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href)),
];

describe("every page has a read tool", () => {
  it("finds the dashboard pages", () => {
    expect(ROUTES.length).toBeGreaterThan(50);
  });

  it.each(ROUTES)("%s is mapped to read tools or allowlisted", (route) => {
    const mapped = route in PAGE_TOOLS;
    const allowed = route in NO_TOOL;
    expect(
      mapped !== allowed,
      `${route}: add it to PAGE_TOOLS (its read tools) or, if it truly needs none, to NO_TOOL with the reason`,
    ).toBe(true);
  });

  it("maps every nav entry", () => {
    const unmapped = NAV_HREFS.filter(
      (href) => !(href in PAGE_TOOLS) && !(href in NO_TOOL),
    );
    expect(unmapped).toEqual([]);
  });

  it("names only pages that exist", () => {
    const routes = new Set(ROUTES);
    const stale = [...Object.keys(PAGE_TOOLS), ...Object.keys(NO_TOOL)].filter(
      (r) => !routes.has(r),
    );
    expect(stale).toEqual([]);
  });

  it("names only registered read tools", () => {
    const reads = new Set(
      AI_ACTIONS.filter((a) => a.sideEffect === "read").map((a) => a.name),
    );
    const unknown = Object.values(PAGE_TOOLS)
      .flat()
      .filter((name) => !reads.has(name));
    expect(unknown).toEqual([]);
  });
});
