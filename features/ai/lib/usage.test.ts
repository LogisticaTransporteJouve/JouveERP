import { describe, expect, it } from "vitest";

import { estimateCostUsd } from "./chat-store";
import { formatTokens } from "../components/ai-usage-meter";

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

describe("estimateCostUsd", () => {
  it("prices input + output at the chat model's per-token rate", () => {
    // 1M input @ $3 + 1M output @ $15 = $18.
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBe(18);
    expect(estimateCostUsd(0, 0)).toBe(0);
  });
});
