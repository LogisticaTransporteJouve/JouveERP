import { describe, expect, it } from "vitest";

import { AI_MAX_STEPS, SYSTEM_PROMPT } from "./agent";
import { AI_CHAT_MODEL, AI_TITLE_MODEL, buildChatModel } from "./model";

describe("ai agent config", () => {
  it("bounds the tool loop with a positive step cap", () => {
    expect(AI_MAX_STEPS).toBeGreaterThan(0);
    expect(AI_MAX_STEPS).toBeLessThanOrEqual(20);
  });

  it("uses the planned models", () => {
    expect(AI_CHAT_MODEL).toBe("claude-sonnet-4-6");
    expect(AI_TITLE_MODEL).toBe("claude-haiku-4-5");
  });

  it("builds a chat model handle without needing the API key at construction", () => {
    expect(buildChatModel().model).toBeTruthy();
  });
});

describe("system prompt guardrails", () => {
  it("states the read-only constraint and anti-injection rule", () => {
    expect(SYSTEM_PROMPT).toContain("JouveERP");
    expect(SYSTEM_PROMPT.toUpperCase()).toContain("READ-ONLY");
    // DB text must be treated as data, not instructions.
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("instructions");
    // Must still instruct the assistant to reply to users in Spanish.
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("rioplatense");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });
});
