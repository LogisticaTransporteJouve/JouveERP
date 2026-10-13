import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
let todayTokens: number | Error = 0;

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }),
    rpc: async () =>
      todayTokens instanceof Error
        ? { data: null, error: todayTokens }
        : { data: [{ total_tokens: todayTokens, cost_usd: 0 }], error: null },
  }),
}));

const { AI_DAILY_TOKEN_CAP, checkAiDailyCap, recordAiUsage } =
  await import("./chat-store");
const { logAudit } = await import("@/lib/actions/audit");

beforeEach(() => {
  inserts.length = 0;
  todayTokens = 0;
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

describe("checkAiDailyCap", () => {
  it("is ok under the cap, exceeded at it, unavailable (fail-closed) on RPC error", async () => {
    todayTokens = AI_DAILY_TOKEN_CAP - 1;
    expect(await checkAiDailyCap()).toBe("ok");
    todayTokens = AI_DAILY_TOKEN_CAP;
    expect(await checkAiDailyCap()).toBe("exceeded");
    todayTokens = new Error("rpc down");
    expect(await checkAiDailyCap()).toBe("unavailable");
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
