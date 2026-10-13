// Per-1M-token prices (USD) by model id — the single source for AI cost
// estimation (chat turns, titles, Document Intelligence, tool-call repair).
//
// Anthropic rates: Anthropic first-party API pricing as of 2026-10 (Claude
// Sonnet 5.5 $2 / $10, cache read $0.20, 5-minute cache write $2.50; Claude
// Haiku 5.5 $0.10 / $0.50 for prompts ≤100K tokens, cache read 0.1×, 5-minute
// cache write 1.25×). Haiku 5.5's >100K-token rate card ($0.50 / $2.50) is not
// modeled: every Haiku call here (titles, classification, repair) is a small
// single prompt.
//
// A turn may be served by a fallback provider, so cost is priced by the model
// that actually answered. Gemini/GPT rates are approximate and their cache
// discount is not modeled (cached tokens priced at the full input rate —
// over-estimates, never under-estimates).

import { AI_CHAT_MODEL, AI_TITLE_MODEL } from "../model";

export type ModelPricing = {
  /** Uncached input. */
  in: number;
  out: number;
  /** Input tokens served from the prompt cache. */
  cacheRead: number;
  /** Input tokens written to the prompt cache (5-minute TTL). */
  cacheWrite: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  [AI_CHAT_MODEL]: { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  [AI_TITLE_MODEL]: { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "gemini-pro-latest": { in: 1.25, out: 10, cacheRead: 1.25, cacheWrite: 1.25 },
  "gpt-5.2": { in: 1.25, out: 10, cacheRead: 1.25, cacheWrite: 1.25 },
};

/** Unknown ids are priced at the primary chat model's rate. */
export const DEFAULT_PRICING: ModelPricing = MODEL_PRICING[AI_CHAT_MODEL] ?? {
  in: 2,
  out: 10,
  cacheRead: 0.2,
  cacheWrite: 2.5,
};

export function pricingFor(model: string | undefined): ModelPricing {
  return (model ? MODEL_PRICING[model] : undefined) ?? DEFAULT_PRICING;
}

export type TokenUsage = {
  /**
   * TOTAL input tokens, as the AI SDK reports them (uncached + cache read +
   * cache write).
   */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/**
 * Estimated USD cost of a call/turn. Cache reads are billed at the discounted
 * rate and cache writes at the write rate; only the remainder of the input is
 * billed at the full input rate.
 */
export function estimateCostUsd(usage: TokenUsage, model?: string): number {
  const price = pricingFor(model);
  const cacheRead = Math.max(0, usage.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0);
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const cost =
    (uncached * price.in +
      cacheRead * price.cacheRead +
      cacheWrite * price.cacheWrite +
      Math.max(0, usage.outputTokens) * price.out) /
    1_000_000;
  return Number(cost.toFixed(6));
}
