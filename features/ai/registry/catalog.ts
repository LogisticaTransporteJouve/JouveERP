import {
  getChartOfAccounts,
  getCostCenters,
  getInflationAdjustments,
  getJournalEntries,
  getLedger,
  getLibroIvaCompras,
  getLibroIvaVentas,
  getTrialBalance,
} from "./actions/accounting";
import { getAfipStatus } from "./actions/afip";
import { getAuditEvents } from "./actions/audit";
import {
  getClientMargin,
  getClientPaymentBehavior,
  getDriverActivity,
  getTopCosts,
  getVehicleEconomics,
} from "./actions/cross";
import {
  getAccounts,
  getChecks,
  getIssuedChecks,
  getRecurringPayments,
  getTransactions,
} from "./actions/cash";
import { proposeDocumentScan } from "./actions/documents";
import {
  getDrivers,
  getFleetDocuments,
  getFleetMargin,
  getFleetProfitability,
  getFuelLoads,
  getMaintenance,
  getShipmentsSummary,
  getTrips,
  getVehicleKm,
  getVehicles,
} from "./actions/fleet";
import { getAttachments, searchGlobal } from "./actions/general";
import {
  getAttendance,
  getEmployees,
  getExpiringDocuments,
  searchEmployees,
} from "./actions/hr";
import {
  getAttendanceSummary,
  getDriverExtras,
  getEmployeeAccount,
  getEmployeeAccountBalances,
  getLeavesSummary,
  getFinalSettlement,
  getGarnishments,
  getPayrollConcepts,
  getPayrollPeriodDetail,
  getPayrollPeriods,
  getPayrollSummary,
  getSalaryHistory,
  getTripExtrasSuggestion,
  getVacationOverview,
} from "./actions/payroll";
import {
  getPaymentOrders,
  getPurchaseInvoices,
  getSupplierAging,
  getSupplierCategories,
  getSupplierPriceEvolution,
  getSupplierPurchasesSummary,
  getSupplierUpcomingDues,
  searchSuppliers,
} from "./actions/purchases";
import {
  proposeExchangeRate,
  proposeJournalEntry,
  proposeLeave,
} from "./actions/proposals";
import { getClientAging } from "./actions/receivables";
import {
  getClientSalesSummary,
  getInvoices,
  getReceipts,
  searchClients,
} from "./actions/sales";
import {
  getBalanceSheet,
  getCostCenterBreakdown,
  getExchangeRates,
  getExpenseByCategory,
  getIncomeStatement,
  getLoanDetail,
  getLoans,
} from "./actions/statements";
import {
  getManagementPnL,
  getManagementPnLDocuments,
} from "./actions/management";
import { getMonthlyPackageStatus } from "./actions/monthly-package";
import {
  getLateInterestCandidates,
  proposeBankMatches,
  proposeClientTariff,
  proposeLateInterestNd,
  proposeTask,
} from "./actions/operations-proposals";
import { getTasks } from "./actions/tasks";
import { getTaxDocuments } from "./actions/taxes";
import { getTodayOverview } from "./actions/today";
import { getTreasurySummary } from "./actions/treasury";
import {
  getPalletsSummary,
  getProducts,
  getStorageBilling,
  getStorageBillingRuns,
  getStorageTariffs,
  getWarehouses,
} from "./actions/warehouse";
import { proposeAiWorkflow } from "./actions/workflows";
import type { AiAction } from "./define";

/** Every action the assistant knows, one definition each. The chat tools,
 *  the capabilities summary and the proposal executors are generated from
 *  this list per user. */
export const AI_ACTIONS: readonly AiAction[] = [
  // Ventas / cuentas por cobrar
  getClientAging,
  getInvoices,
  getReceipts,
  searchClients,
  getClientSalesSummary,
  getClientMargin,
  getClientPaymentBehavior,
  getLateInterestCandidates,
  proposeLateInterestNd,
  // Compras / cuentas por pagar
  getSupplierAging,
  getPurchaseInvoices,
  getPaymentOrders,
  searchSuppliers,
  getSupplierPurchasesSummary,
  getSupplierUpcomingDues,
  getSupplierPriceEvolution,
  getSupplierCategories,
  // Tesorería
  getTreasurySummary,
  getAccounts,
  getTransactions,
  getChecks,
  getIssuedChecks,
  getRecurringPayments,
  proposeBankMatches,
  // Contabilidad
  getTrialBalance,
  getLedger,
  getLibroIvaVentas,
  getLibroIvaCompras,
  getChartOfAccounts,
  getJournalEntries,
  getCostCenters,
  getInflationAdjustments,
  getIncomeStatement,
  getBalanceSheet,
  getManagementPnL,
  getManagementPnLDocuments,
  getTopCosts,
  getCostCenterBreakdown,
  getExpenseByCategory,
  getLoans,
  getLoanDetail,
  getExchangeRates,
  getMonthlyPackageStatus,
  getTaxDocuments,
  proposeJournalEntry,
  proposeExchangeRate,
  // RRHH / sueldos
  getEmployees,
  searchEmployees,
  getAttendance,
  getExpiringDocuments,
  getPayrollPeriods,
  getPayrollPeriodDetail,
  getPayrollSummary,
  getPayrollConcepts,
  getGarnishments,
  getFinalSettlement,
  getEmployeeAccountBalances,
  getEmployeeAccount,
  getSalaryHistory,
  getDriverExtras,
  getTripExtrasSuggestion,
  getVacationOverview,
  getLeavesSummary,
  getAttendanceSummary,
  proposeLeave,
  // Flota / transporte
  getVehicles,
  getTrips,
  getFuelLoads,
  getMaintenance,
  getFleetDocuments,
  getVehicleKm,
  getFleetProfitability,
  getFleetMargin,
  getVehicleEconomics,
  getDriverActivity,
  getDrivers,
  getShipmentsSummary,
  getTodayOverview,
  // Depósito
  getPalletsSummary,
  getWarehouses,
  getProducts,
  getStorageTariffs,
  getStorageBilling,
  getStorageBillingRuns,
  proposeClientTariff,
  // AFIP
  getAfipStatus,
  // General
  searchGlobal,
  getAttachments,
  getTasks,
  proposeTask,
  getAuditEvents,
  proposeAiWorkflow,
  proposeDocumentScan,
];
