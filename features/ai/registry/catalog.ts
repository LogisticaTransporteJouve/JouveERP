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
import {
  getClientAccount,
  getClientTariffs,
  getSupplierAccount,
} from "./actions/account-statements";
import { getBackups, getImportRuns, getUsers } from "./actions/admin";
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
import {
  getInvoiceDetail,
  getPaymentOrderDetail,
  getPurchaseInvoiceDetail,
  getReceiptDetail,
} from "./actions/details";
import {
  getDocumentExtractions,
  proposeDocumentScan,
} from "./actions/documents";
import { proposeRecategorizeExpense } from "./actions/expense-proposals";
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
import {
  getShipments,
  getTripDetail,
  getVehicleUsage,
} from "./actions/fleet-detail";
import { getAttachments, searchFiles } from "./actions/general";
import { searchGuide } from "./actions/guide";
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
  getArcaReceivedVouchers,
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
import {
  getDriverSettlements,
  getFreightSettlements,
} from "./actions/settlements";
import { getTasks } from "./actions/tasks";
import { getTaxDocuments } from "./actions/taxes";
import { getTodayOverview, getUpcomingDueDates } from "./actions/today";
import {
  getBankReconciliation,
  getCashFlow,
  getTreasurySummary,
} from "./actions/treasury";
import {
  getPallets,
  getPalletsSummary,
  getProducts,
  getStorageBilling,
  getStorageBillingRuns,
  getStorageTariffs,
  getWarehouses,
} from "./actions/warehouse";
import { getAiWorkflows, proposeAiWorkflow } from "./actions/workflows";
import type { AiAction } from "./define";

/** Every action the assistant knows, one definition each. The chat tools,
 *  the capabilities summary and the proposal executors are generated from
 *  this list per user. */
export const AI_ACTIONS: readonly AiAction[] = [
  // Ventas / cuentas por cobrar
  getClientAging,
  getInvoices,
  getReceipts,
  getInvoiceDetail,
  getReceiptDetail,
  searchClients,
  getClientAccount,
  getClientSalesSummary,
  getClientMargin,
  getClientPaymentBehavior,
  getLateInterestCandidates,
  proposeLateInterestNd,
  getFreightSettlements,
  // Compras / cuentas por pagar
  getSupplierAging,
  getPurchaseInvoices,
  getPaymentOrders,
  getPurchaseInvoiceDetail,
  getPaymentOrderDetail,
  getArcaReceivedVouchers,
  searchSuppliers,
  getSupplierAccount,
  getSupplierPurchasesSummary,
  getSupplierUpcomingDues,
  getSupplierPriceEvolution,
  getSupplierCategories,
  // Tesorería
  getTreasurySummary,
  getCashFlow,
  getUpcomingDueDates,
  getAccounts,
  getTransactions,
  getChecks,
  getIssuedChecks,
  getRecurringPayments,
  getDriverSettlements,
  getBankReconciliation,
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
  proposeRecategorizeExpense,
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
  getTripDetail,
  getVehicleUsage,
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
  getShipments,
  getTodayOverview,
  // Depósito
  getPalletsSummary,
  getPallets,
  getWarehouses,
  getProducts,
  getStorageTariffs,
  getStorageBilling,
  getStorageBillingRuns,
  getClientTariffs,
  proposeClientTariff,
  // AFIP
  getAfipStatus,
  // General
  searchGuide,
  getAttachments,
  searchFiles,
  getDocumentExtractions,
  getTasks,
  proposeTask,
  getAuditEvents,
  getUsers,
  getImportRuns,
  getBackups,
  getAiWorkflows,
  proposeAiWorkflow,
  proposeDocumentScan,
];
