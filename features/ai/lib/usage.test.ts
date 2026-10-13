import { describe, expect, it } from "vitest";

import { formatTokens } from "../components/ai-usage-meter";
import { usageTokens } from "./chat-store";
import { DEFAULT_PRICING, MODEL_PRICING, estimateCostUsd } from "./pricing";

describe("formatTokens", () => {
  it("formats counts compactly", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1K");
    expect(formatTokens(120_000)).toBe("120K");
    expect(formatTokens(500_000)).toBe("500K");
    expect(formatTokens(1_500_000)).toBe("1.5M");
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
