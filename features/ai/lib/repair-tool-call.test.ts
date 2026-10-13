import { InvalidToolInputError, NoSuchToolError, type ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  REPAIR_CONTEXT_MESSAGES,
  boundRepairContext,
  hasRecoverableInput,
  makeRepairToolCall,
  minimalValidInstance,
  type RegenerateArgs,
} from "./repair-tool-call";

const schema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const },
    limit: { type: "integer" as const },
    ids: { type: "array" as const },
  },
  required: ["query", "ids"],
};

function repairOptions(input: string, error: Error) {
  return {
    system: undefined,
    messages: [] satisfies ModelMessage[],
    toolCall: {
      type: "tool-call" as const,
      toolCallId: "c1",
      toolName: "searchClients",
      input,
    },
    tools: {},
    inputSchema: async () => schema,
    error: InvalidToolInputError.isInstance(error)
      ? error
      : new NoSuchToolError({ toolName: "nope" }),
  };
}

const invalid = (input: string) =>
  new InvalidToolInputError({
    toolName: "searchClients",
    toolInput: input,
    cause: new Error("expected object"),
  });

describe("makeRepairToolCall", () => {
  it("regenerates arguments for a mis-filled call", async () => {
    const regenerate = vi.fn<RegenerateArgs>(async () => ({
      query: "acme",
      ids: [],
    }));
    const repair = makeRepairToolCall(regenerate);
    const raw = '"acme"';
    const out = await repair(repairOptions(raw, invalid(raw)));
    expect(regenerate).toHaveBeenCalledOnce();
    expect(out?.input).toBe(JSON.stringify({ query: "acme", ids: [] }));
    expect(out?.toolCallId).toBe("c1");
  });

  it("falls back to a schema-valid empty object when regeneration fails", async () => {
    const repair = makeRepairToolCall(async () => null);
    const raw = '{"query": "acme"'; // truncated
    const out = await repair(repairOptions(raw, invalid(raw)));
    expect(out?.input).toBe(JSON.stringify({ query: "", ids: [] }));
  });

  it("does not consult the model when there is no intent to recover", async () => {
    const regenerate = vi.fn<RegenerateArgs>(async () => ({ query: "x" }));
    const repair = makeRepairToolCall(regenerate);
    const out = await repair(repairOptions("{}", invalid("{}")));
    expect(regenerate).not.toHaveBeenCalled();
    expect(out?.input).toBe(JSON.stringify({ query: "", ids: [] }));
  });

  it("leaves unknown-tool errors alone", async () => {
    const regenerate = vi.fn<RegenerateArgs>(async () => ({ query: "x" }));
    const repair = makeRepairToolCall(regenerate);
    const out = await repair(repairOptions("{}", new Error("no such tool")));
    expect(out).toBeNull();
    expect(regenerate).not.toHaveBeenCalled();
  });
});

describe("repair helpers", () => {
  it("hasRecoverableInput", () => {
    expect(hasRecoverableInput("")).toBe(false);
    expect(hasRecoverableInput(" { } ")).toBe(false);
    expect(hasRecoverableInput("null")).toBe(false);
    expect(hasRecoverableInput("[]")).toBe(false);
    expect(hasRecoverableInput('{"a":1}')).toBe(true);
    expect(hasRecoverableInput('{"a":')).toBe(true);
  });

  it("minimalValidInstance fills required fields by type", () => {
    expect(minimalValidInstance(schema)).toEqual({ query: "", ids: [] });
    expect(minimalValidInstance(null)).toEqual({});
  });

  it("boundRepairContext drops system messages and orphaned tool results", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "s" },
      ...Array.from({ length: REPAIR_CONTEXT_MESSAGES + 4 }, (_, i) =>
        i % 2 === 0
          ? { role: "user" as const, content: `u${i}` }
          : {
              role: "tool" as const,
              content: [
                {
                  type: "tool-result" as const,
                  toolCallId: `t${i}`,
                  toolName: "x",
                  output: { type: "text" as const, value: "r" },
                },
              ],
            },
      ),
    ];
    const out = boundRepairContext(msgs);
    expect(out.length).toBeLessThanOrEqual(REPAIR_CONTEXT_MESSAGES);
    expect(out[0]?.role).not.toBe("tool");
    expect(out.some((m) => m.role === "system")).toBe(false);
  });

  it("boundRepairContext starts at a user turn and strips reasoning", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "leading answer" }],
      },
      { role: "user", content: "¿Cuánto me debe Acme?" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking…" },
          {
            type: "tool-call",
            toolCallId: "t1",
            toolName: "getClientAging",
            input: {},
          },
        ],
      },
      { role: "assistant", content: [{ type: "reasoning", text: "only" }] },
    ];
    const out = boundRepairContext(msgs);
    expect(out[0]).toEqual({ role: "user", content: "¿Cuánto me debe Acme?" });
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "t1",
          toolName: "getClientAging",
          input: {},
        },
      ],
    });
  });
});
