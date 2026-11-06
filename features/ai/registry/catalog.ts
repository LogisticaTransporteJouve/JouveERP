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
  getFreightTariffs,
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
import {
  proposeEmployeeAccountCash,
  proposeEmployeeAccountMovement,
} from "./actions/employee-account-proposals";
import { proposeRecategorizeExpense } from "./actions/expense-proposals";
import {
  proposeArcaPurchase,
  proposePurchaseInvoice,
} from "./actions/purchase-proposals";
import {
  proposeSupplier,
  proposeSupplierUpdate,
} from "./actions/supplier-proposals";
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
import {
  proposeDriverSettlement,
  proposeDriverSettlementConfirm,
  proposeDriverSettlementDifference,
} from "./actions/driver-settlement-proposals";
import {
  proposeFreightSettlement,
  proposeFreightSettlementConfirm,
  proposeFuelLoad,
  proposeMaintenance,
  proposeShipment,
  proposeShipmentStatus,
  proposeTrip,
  proposeVehicleKm,
} from "./actions/fleet-proposals";
import { getAttachments, searchFiles } from "./actions/general";
import { proposeStorageInvoice } from "./actions/storage-proposals";
import { searchGuide } from "./actions/guide";
import {
  proposeAttendance,
  proposeCreateEmployee,
  proposeUpdateEmployee,
} from "./actions/hr-proposals";
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
  getLeavesByRange,
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
import { proposePayrollPayment } from "./actions/payroll-proposals";
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
import { proposeLoanInstallmentPayment } from "./actions/loans-proposals";
import { getMonthlyPackageStatus } from "./actions/monthly-package";
import {
  getLateInterestCandidates,
  proposeBankMatches,
  proposeClientTariff,
  proposeLateInterestNd,
  proposeTask,
} from "./actions/operations-proposals";
import {
  proposeClient,
  proposeClientUpdate,
  proposeCreditDebitNote,
  proposeInvoice,
  proposeInvoiceEmail,
} from "./actions/sales-proposals";
import {
  getDriverSettlements,
  getFreightSettlements,
} from "./actions/settlements";
import {
  proposeCheckDeposit,
  proposeIssuedCheck,
  proposeManualCheck,
} from "./actions/checks-proposals";
import {
  proposeCashMovement,
  proposePaymentOrder,
  proposeReceipt,
  proposeReceiptEmail,
  proposeTransfer,
} from "./actions/treasury-proposals";
import { getTasks } from "./actions/tasks";
import { proposeTaxDocument, proposeTaxPayment } from "./actions/tax-proposals";
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
  proposeClient,
  proposeClientUpdate,
  proposeInvoice,
  proposeCreditDebitNote,
  proposeInvoiceEmail,
  proposeReceipt,
  proposeReceiptEmail,
  getFreightSettlements,
  proposeFreightSettlement,
  proposeFreightSettlementConfirm,
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
  proposePaymentOrder,
  proposePurchaseInvoice,
  proposeArcaPurchase,
  proposeSupplier,
  proposeSupplierUpdate,
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
  proposeCashMovement,
  proposeTransfer,
  proposeManualCheck,
  proposeCheckDeposit,
  proposeIssuedCheck,
  proposeDriverSettlement,
  proposeDriverSettlementConfirm,
  proposeDriverSettlementDifference,
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
  proposeLoanInstallmentPayment,
  getExchangeRates,
  getMonthlyPackageStatus,
  getTaxDocuments,
  proposeTaxDocument,
  proposeTaxPayment,
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
  getLeavesByRange,
  getAttendanceSummary,
  proposeLeave,
  proposeCreateEmployee,
  proposeUpdateEmployee,
  proposePayrollPayment,
  proposeEmployeeAccountCash,
  proposeEmployeeAccountMovement,
  proposeAttendance,
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
  proposeTrip,
  proposeShipment,
  proposeShipmentStatus,
  proposeFuelLoad,
  proposeMaintenance,
  proposeVehicleKm,
  // Depósito
  getPalletsSummary,
  getPallets,
  getWarehouses,
  getProducts,
  getStorageTariffs,
  getStorageBilling,
  getStorageBillingRuns,
  proposeStorageInvoice,
  getClientTariffs,
  proposeClientTariff,
  getFreightTariffs,
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
