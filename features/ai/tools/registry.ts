import {
  getPaymentOrders,
  getPurchaseInvoices,
  getSupplierAging,
  searchSuppliers,
} from "./purchases";
import { getClientAging } from "./receivables";
import { getInvoices, getReceipts, searchClients } from "./sales";
import { getTreasurySummary } from "./treasury";
import {
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
  // Ventas / cuentas por cobrar
  getClientAging,
  getInvoices,
  getReceipts,
  searchClients,
  // Compras / cuentas por pagar
  getSupplierAging,
  getPurchaseInvoices,
  getPaymentOrders,
  searchSuppliers,
  // Caja / tesorería
  getTreasurySummary,
  // Contabilidad
  getTrialBalance,
  getLedger,
  getLibroIvaVentas,
  getLibroIvaCompras,
} as const;

export type AiToolName = keyof typeof aiTools;

export const AI_TOOL_NAMES = Object.keys(aiTools) as AiToolName[];
