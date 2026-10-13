import type { ModelMessage, UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  AI_MAX_STEPS,
  SYSTEM_PROMPT,
  stripReasoningParts,
  withTailCacheBreakpoint,
} from "./agent";
import { AI_CHAT_MODEL, AI_TITLE_MODEL, buildChatModel } from "./model";

const EPHEMERAL = { anthropic: { cacheControl: { type: "ephemeral" } } };

describe("ai agent config", () => {
  it("bounds the tool loop with a positive step cap", () => {
    expect(AI_MAX_STEPS).toBeGreaterThan(0);
    expect(AI_MAX_STEPS).toBeLessThanOrEqual(20);
  });

  it("uses the planned models", () => {
    expect(AI_CHAT_MODEL).toBe("claude-sonnet-5-5");
    expect(AI_TITLE_MODEL).toBe("claude-haiku-5-5");
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

describe("withTailCacheBreakpoint", () => {
  const system: ModelMessage = {
    role: "system",
    content: "base",
    providerOptions: EPHEMERAL,
  };

  it("adds a breakpoint to a trailing user message", () => {
    const out = withTailCacheBreakpoint([
      system,
      { role: "user", content: [{ type: "text", text: "hola" }] },
    ]);
    expect(out[1]?.providerOptions).toEqual(EPHEMERAL);
    // The system breakpoint is untouched and the input isn't mutated.
    expect(out[0]).toBe(system);
  });

  it("puts it on the last tool-result part of a trailing tool message", () => {
    const toolMsg: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "a",
          toolName: "searchClients",
          output: { type: "json", value: [] },
        },
        {
          type: "tool-result",
          toolCallId: "b",
          toolName: "getClientAging",
          output: { type: "json", value: {} },
        },
      ],
    };
    const out = withTailCacheBreakpoint([system, toolMsg]);
    const last = out[1];
    expect(last?.role).toBe("tool");
    if (last?.role !== "tool" || toolMsg.role !== "tool") return;
    const options = (part: (typeof last.content)[number] | undefined) =>
      part?.type === "tool-result" ? part.providerOptions : "not a result";
    expect(options(last.content[0])).toBeUndefined();
    expect(options(last.content[1])).toEqual(EPHEMERAL);
    expect(options(toolMsg.content[1])).toBeUndefined();
  });

  it("adds exactly one breakpoint (two with the system prompt's)", () => {
    const msgs: ModelMessage[] = [
      system,
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    const out = withTailCacheBreakpoint(msgs);
    const marked = out.filter((m) => m.providerOptions !== undefined);
    expect(marked).toHaveLength(2);
  });
});

describe("stripReasoningParts", () => {
  it("drops reasoning from replayed turns and keeps everything else", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hola" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "" },
          { type: "text", text: "respuesta" },
        ],
      },
    ];
    const out = stripReasoningParts(messages);
    expect(out[0]).toBe(messages[0]);
    expect(out[1]?.parts.map((p) => p.type)).toEqual(["step-start", "text"]);
  });
});
