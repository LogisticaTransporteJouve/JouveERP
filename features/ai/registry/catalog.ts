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
import {
  getAccounts,
  getChecks,
  getIssuedChecks,
  getRecurringPayments,
  getTransactions,
} from "./actions/cash";
import {
  getDrivers,
  getFleetDocuments,
  getFleetMargin,
  getFleetProfitability,
  getFuelLoads,
  getMaintenance,
  getShipmentsSummary,
  getTrips,
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
  getLeavesSummary,
  getPayrollConcepts,
  getPayrollPeriods,
  getPayrollSummary,
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
import { getTreasurySummary } from "./actions/treasury";
import {
  getPalletsSummary,
  getProducts,
  getStorageBilling,
  getStorageBillingRuns,
  getStorageTariffs,
  getWarehouses,
} from "./actions/warehouse";
import type { AiAction } from "./define";

/** Every action the assistant knows, one definition each. The chat tools and
 *  the capabilities summary are generated from this list per user. */
export const AI_ACTIONS: readonly AiAction[] = [
  // Ventas / cuentas por cobrar
  getClientAging,
  getInvoices,
  getReceipts,
  searchClients,
  getClientSalesSummary,
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
  getCostCenterBreakdown,
  getExpenseByCategory,
  getLoans,
  getLoanDetail,
  getExchangeRates,
  // RRHH / sueldos
  getEmployees,
  searchEmployees,
  getAttendance,
  getExpiringDocuments,
  getPayrollPeriods,
  getPayrollSummary,
  getPayrollConcepts,
  getDriverExtras,
  getVacationOverview,
  getLeavesSummary,
  getAttendanceSummary,
  // Flota / transporte
  getVehicles,
  getTrips,
  getFuelLoads,
  getMaintenance,
  getFleetDocuments,
  getFleetProfitability,
  getFleetMargin,
  getDrivers,
  getShipmentsSummary,
  // Depósito
  getPalletsSummary,
  getWarehouses,
  getProducts,
  getStorageTariffs,
  getStorageBilling,
  getStorageBillingRuns,
  // AFIP
  getAfipStatus,
  // General
  searchGlobal,
  getAttachments,
];
