import { describe, expect, it } from "vitest";

import { usageTokens } from "./chat-store";
import { DEFAULT_PRICING, MODEL_PRICING, estimateCostUsd } from "./pricing";
import { aiSpendView } from "./usage-money";

describe("aiSpendView", () => {
  const usdRate = { rate: 1545.5, rate_date: "2026-11-05" };

  it("shows today's spend and the cap in pesos at the official dollar", () => {
    expect(aiSpendView({ costUsd: 0.52, capUsd: 1.5, usdRate })).toEqual({
      spent: "$ 804",
      cap: "$ 2.318",
      pct: 35,
      atCap: false,
      tooltip:
        "Gasto de IA de hoy: US$ 0,52 ≈ $ 804 al dólar oficial del 5 nov 2026",
    });
  });

  it("fills the bar and flags the cap once spend reaches it", () => {
    const view = aiSpendView({ costUsd: 2, capUsd: 1.5, usdRate });
    expect(view.pct).toBe(100);
    expect(view.atCap).toBe(true);
  });

  it("falls back to dollars when no rate is loaded, never tokens", () => {
    const view = aiSpendView({ costUsd: 0.52, capUsd: 1.5, usdRate: null });
    expect(view.spent).toBe("US$ 0,52");
    expect(view.cap).toBe("US$ 1,50");
    expect(view.tooltip).toContain("sin cotización");
    expect(JSON.stringify(view)).not.toMatch(/token/i);
  });
});

describe("MODEL_PRICING", () => {
  it("is keyed by the 5.5 model ids with their per-MTok rates", () => {
    expect(MODEL_PRICING["claude-sonnet-5-5"]).toEqual({
      in: 2,
      out: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
    });
    expect(MODEL_PRICING["claude-haiku-5-5"]).toEqual({
      in: 0.1,
      out: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
    });
    // Fallback providers stay priced.
    expect(MODEL_PRICING["gemini-pro-latest"]).toBeDefined();
    expect(MODEL_PRICING["gpt-5.2"]).toBeDefined();
    expect(DEFAULT_PRICING).toBe(MODEL_PRICING["claude-sonnet-5-5"]);
  });
});

describe("estimateCostUsd", () => {
  it("prices uncached input + output at the chat model's rate", () => {
    // 1M input @ $2 + 1M output @ $10 = $12.
    expect(
      estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(12);
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("bills cache reads at the discounted rate, not the full input rate", () => {
    // 1M total input of which 900K were cache reads: 100K @ $2 + 900K @ $0.20.
    const cost = estimateCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 900_000,
      },
      "claude-sonnet-5-5",
    );
    expect(cost).toBeCloseTo(0.2 + 0.18, 6);
  });

  it("bills cache writes at the write rate", () => {
    // 1M total input, all written to cache: 1M @ $2.50.
    expect(
      estimateCostUsd(
        {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheWriteTokens: 1_000_000,
        },
        "claude-sonnet-5-5",
      ),
    ).toBe(2.5);
  });

  it("prices by the model that served the call", () => {
    expect(
      estimateCostUsd(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        "claude-haiku-5-5",
      ),
    ).toBe(0.6);
  });
});

describe("usageTokens", () => {
  it("keeps total input and splits out cache read/write", () => {
    expect(
      usageTokens({
        inputTokens: 1_200,
        inputTokenDetails: {
          noCacheTokens: 200,
          cacheReadTokens: 900,
          cacheWriteTokens: 100,
        },
        outputTokens: 50,
        outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
        totalTokens: 1_250,
      }),
    ).toEqual({
      inputTokens: 1_200,
      outputTokens: 50,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
    });
  });
});
