import { MockLanguageModelV4 } from "ai/test";

// A model that plays back fixed turns, for tests and offline evals: a tool
// call, then text. It records what it was offered (tools, prompt) on
// `doGenerateCalls`.

export type GenerateResult = Awaited<
  ReturnType<MockLanguageModelV4["doGenerate"]>
>;

const usage = {
  inputTokens: { total: 1_000, noCache: 1_000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
};

export function toolCallTurn(
  toolName: string,
  input: unknown,
  toolCallId = "call-1",
): GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool_use" },
    usage,
    warnings: [],
  };
}

export function textTurn(text: string): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "end_turn" },
    usage,
    warnings: [],
  };
}

export function scriptedModel(turns: GenerateResult[]): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const turn = turns[i++];
      if (!turn) throw new Error("unexpected extra model call");
      return turn;
    },
  });
}

/** Tool names a recorded model call was offered. */
export function offeredTools(model: MockLanguageModelV4, call = 0): string[] {
  return (model.doGenerateCalls[call]?.tools ?? []).map((t) => t.name);
}
