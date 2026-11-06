import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
let todayCost: number | Error = 0;

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }),
    rpc: async () =>
      todayCost instanceof Error
        ? { data: null, error: todayCost }
        : { data: [{ total_tokens: 0, cost_usd: todayCost }], error: null },
  }),
}));

const {
  AI_BACKGROUND_CAP_FRACTION,
  AI_DAILY_COST_CAP_USD,
  checkAiDailyCap,
  isOverDailyCap,
  recordAiUsage,
} = await import("./chat-store");
const { logAudit } = await import("@/lib/actions/audit");

beforeEach(() => {
  inserts.length = 0;
  todayCost = 0;
});

describe("recordAiUsage", () => {
  it("writes kind + cache-aware cost for non-chat calls (no session)", async () => {
    await recordAiUsage({
      kind: "document_extract",
      userId: "u1",
      model: "claude-sonnet-5-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(inserts).toEqual([
      {
        table: "ai_usage",
        row: expect.objectContaining({
          kind: "document_extract",
          session_id: null,
          user_id: "u1",
          prompt_tokens: 1_000_000,
          cached_tokens: 1_000_000,
          cost_usd: 0.2,
          tool_names: null,
        }),
      },
    ]);
  });
});

describe("isOverDailyCap", () => {
  it("gates on spend, not tokens", () => {
    expect(isOverDailyCap({ totalTokens: 10_000_000, costUsd: 0.1 })).toBe(
      false,
    );
    expect(
      isOverDailyCap({ totalTokens: 0, costUsd: AI_DAILY_COST_CAP_USD }),
    ).toBe(true);
  });
});

describe("checkAiDailyCap", () => {
  it("is ok under the cap, exceeded at it, unavailable (fail-closed) on RPC error", async () => {
    todayCost = AI_DAILY_COST_CAP_USD - 0.01;
    expect(await checkAiDailyCap()).toBe("ok");
    todayCost = AI_DAILY_COST_CAP_USD;
    expect(await checkAiDailyCap()).toBe("exceeded");
    todayCost = new Error("rpc down");
    expect(await checkAiDailyCap()).toBe("unavailable");
  });

  it("stops background jobs at AI_BACKGROUND_CAP_FRACTION, leaving headroom for chat", async () => {
    expect(AI_BACKGROUND_CAP_FRACTION).toBeLessThan(1);
    const threshold = AI_DAILY_COST_CAP_USD * AI_BACKGROUND_CAP_FRACTION;
    todayCost = threshold - 0.01;
    expect(await checkAiDailyCap({ background: true })).toBe("ok");
    todayCost = threshold;
    expect(await checkAiDailyCap({ background: true })).toBe("exceeded");
    expect(await checkAiDailyCap()).toBe("ok");
    todayCost = new Error("rpc down");
    expect(await checkAiDailyCap({ background: true })).toBe("unavailable");
  });
});

describe("logAudit actor type", () => {
  it("passes actor_type through when given, and omits it otherwise", async () => {
    await logAudit("ai.tool_call", "u1", { tool: "x" }, "s1", {
      actorType: "ai-agent",
    });
    await logAudit("x.y", "u1", {});
    expect(inserts[0]?.row).toMatchObject({ actor_type: "ai-agent" });
    expect(inserts[1]?.row).not.toHaveProperty("actor_type");
  });
});
