import { getClientAging } from "./receivables";
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
 * catalogue. More tools (sales/purchases/cash list filters, etc.) land in AI.4.
 */
export const aiTools = {
  getClientAging,
  getTreasurySummary,
  getTrialBalance,
  getLedger,
  getLibroIvaVentas,
  getLibroIvaCompras,
} as const;

export type AiToolName = keyof typeof aiTools;

export const AI_TOOL_NAMES = Object.keys(aiTools) as AiToolName[];
