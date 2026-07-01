import {
  getAccounts,
  getChecks,
  getIssuedChecks,
  getTransactions,
} from "./cash";
import {
  getAttendance,
  getEmployees,
  getExpiringDocuments,
  searchEmployees,
} from "./hr";
import {
  getPaymentOrders,
  getPurchaseInvoices,
  getSupplierAging,
  searchSuppliers,
} from "./purchases";
import {
  getFleetDocuments,
  getFleetProfitability,
  getFuelLoads,
  getMaintenance,
  getTrips,
  getVehicles,
} from "./fleet";
import { getClientAging } from "./receivables";
import { getInvoices, getReceipts, searchClients } from "./sales";
import { getTreasurySummary } from "./treasury";
import {
  getChartOfAccounts,
  getCostCenters,
  getInflationAdjustments,
  getJournalEntries,
  getLedger,
  getLibroIvaCompras,
  getLibroIvaVentas,
  getTrialBalance,
} from "./accounting";

/**
 * Registry of read-only AI tools. Each wraps an existing read server action,
 * so the agent inherits the action's `userCan` gate + RLS — it can never read
 * what the calling user can't. The chat agent (AI.2) passes this map as its
 * `tools`; `prepareCall` can filter by route so the model never sees the full
 * catalogue.
 */
export const aiTools = {
  // Sales / accounts receivable
  getClientAging,
  getInvoices,
  getReceipts,
  searchClients,
  // Purchases / accounts payable
  getSupplierAging,
  getPurchaseInvoices,
  getPaymentOrders,
  searchSuppliers,
  // Cash / treasury
  getTreasurySummary,
  getAccounts,
  getTransactions,
  getChecks,
  getIssuedChecks,
  // Accounting
  getTrialBalance,
  getLedger,
  getLibroIvaVentas,
  getLibroIvaCompras,
  getChartOfAccounts,
  getJournalEntries,
  getCostCenters,
  getInflationAdjustments,
  // HR
  getEmployees,
  searchEmployees,
  getAttendance,
  getExpiringDocuments,
  // Flota / transporte
  getVehicles,
  getTrips,
  getFuelLoads,
  getMaintenance,
  getFleetDocuments,
  getFleetProfitability,
} as const;

export type AiToolName = keyof typeof aiTools;

export const AI_TOOL_NAMES = Object.keys(aiTools) as AiToolName[];
