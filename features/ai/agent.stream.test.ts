import { simulateReadableStream, tool, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const usage = {
  inputTokens: { total: 1_000, noCache: 100, cacheRead: 800, cacheWrite: 100 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
};

function streamOf(chunks: StreamPart[]): StreamResult {
  return { stream: simulateReadableStream({ chunks }) };
}

const toolStep = (): StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "searchClients",
      input: JSON.stringify({ query: "acme" }),
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage,
    },
  ]);
const textStep = (): StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Acme no tiene deuda." },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      usage,
    },
  ]);

let mockModel = new MockLanguageModelV4();
const logAudit = vi.fn(async () => undefined);
const recordAiUsage = vi.fn(async () => undefined);

vi.mock("./model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model")>()),
  buildChatModel: () => ({
    model: mockModel,
    servedModel: () => "claude-sonnet-5-5",
  }),
}));
vi.mock("./tools", () => ({
  aiTools: {
    searchClients: tool({
      description: "search",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => ({ rows: [] }),
    }),
  },
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("./lib/chat-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/chat-store")>()),
  recordAiUsage,
}));

const { streamChat } = await import("./agent");

const history: UIMessage[] = [
  {
    id: "a0",
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        text: "",
        providerMetadata: { anthropic: { signature: "old" } },
      },
      { type: "text", text: "Hola" },
    ],
  },
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "¿Cuánto debe Acme?" }],
  },
];

beforeEach(() => {
  logAudit.mockClear();
  recordAiUsage.mockClear();
  const steps = [toolStep(), textStep()];
  let i = 0;
  mockModel = new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[i++];
      if (!step) throw new Error("unexpected extra model call");
      return step;
    },
  });
});

describe("streamChat", () => {
  it("runs the tool loop with explicit output ceiling + effort", async () => {
    const onUsage = vi.fn();
    const result = await streamChat(history, {
      userId: "u1",
      sessionId: "s1",
      onUsage,
    });
    expect(await result.text).toBe("Acme no tiene deuda.");

    const [first] = mockModel.doStreamCalls;
    expect(first?.maxOutputTokens).toBe(16_000);
    expect(first?.providerOptions?.anthropic).toMatchObject({
      effort: "medium",
    });

    // Usage is reported cache-aware (total input + cache read/write split).
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5-5",
        inputTokens: 2_000,
        cacheReadTokens: 1_600,
        cacheWriteTokens: 200,
        toolNames: ["searchClients"],
      }),
    );
  });

  it("moves the cache breakpoint to the newest message on every step", async () => {
    const result = await streamChat(history, { userId: "u1" });
    await result.consumeStream();
    const [first, second] = mockModel.doStreamCalls;

    const p1 = first?.prompt ?? [];
    expect(p1[0]?.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect(p1.at(-1)?.role).toBe("user");
    expect(p1.at(-1)?.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });

    const last = second?.prompt.at(-1);
    expect(last?.role).toBe("tool");
    if (last?.role !== "tool") return;
    expect(last.content.at(-1)?.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    // Exactly system + tail: the previous step's tail breakpoint must not
    // carry forward (Anthropic allows at most 4 per request).
    const marks = (second?.prompt ?? [])
      .flatMap((m) => [
        m.providerOptions?.anthropic,
        ...(typeof m.content === "string"
          ? []
          : m.content.map((part) => part.providerOptions?.anthropic)),
      ])
      .filter((options) => options !== undefined).length;
    expect(marks).toBe(2);
  });

  it("does not replay reasoning from earlier turns", async () => {
    const result = await streamChat(history, { userId: "u1" });
    await result.consumeStream();
    const prompt = mockModel.doStreamCalls[0]?.prompt ?? [];
    const replayedReasoning = prompt.some(
      (m) =>
        m.role === "assistant" &&
        m.content.some((part) => part.type === "reasoning"),
    );
    expect(replayedReasoning).toBe(false);
  });

  it("audits every tool call as the ai-agent", async () => {
    const result = await streamChat(history, { userId: "u1", sessionId: "s1" });
    await result.consumeStream();
    expect(logAudit).toHaveBeenCalledWith(
      "ai.tool_call",
      "u1",
      expect.objectContaining({
        tool: "searchClients",
        input: { query: "acme" },
      }),
      "s1",
      { actorType: "ai-agent" },
    );
  });
});
