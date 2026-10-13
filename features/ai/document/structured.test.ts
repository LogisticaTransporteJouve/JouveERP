import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SUBMIT_TOOL_NAME,
  StructuredOutputError,
  generateStructured,
} from "./structured";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;

const usage = {
  inputTokens: { total: 100, noCache: 40, cacheRead: 50, cacheWrite: 10 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

function textResult(text: string): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "end_turn" },
    usage,
    warnings: [],
  };
}

function toolResult(input: unknown): GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: SUBMIT_TOOL_NAME,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool_use" },
    usage,
    warnings: [],
  };
}

const Schema = z.object({
  number: z.number().nullish(),
  name: z.string().nullish(),
});

function sequenced(results: GenerateResult[]): MockLanguageModelV3 {
  let i = 0;
  return new MockLanguageModelV3({
    modelId: "claude-sonnet-5-5",
    doGenerate: async () => {
      const r = results[Math.min(i, results.length - 1)];
      i++;
      if (!r) throw new Error("no result");
      return r;
    },
  });
}

describe("generateStructured", () => {
  it("never forces the tool choice (Sonnet 5.5 400s on any/tool)", async () => {
    const model = sequenced([toolResult({ number: 12, name: "ACME" })]);
    const { object } = await generateStructured({
      model,
      schema: Schema,
      description: "data",
      system: "extract",
      messages: [{ role: "user", content: "doc" }],
      maxOutputTokens: 1000,
    });
    expect(object).toEqual({ number: 12, name: "ACME" });
    const call = model.doGenerateCalls[0];
    expect(call?.toolChoice).toEqual({ type: "auto" });
    expect(call?.maxOutputTokens).toBe(1000);
    expect(call?.tools?.map((t) => t.name)).toEqual([SUBMIT_TOOL_NAME]);
  });

  it("retries when the model answers in text instead of calling the tool", async () => {
    const model = sequenced([
      textResult("Here is the data: ..."),
      toolResult({ number: 1, name: null }),
    ]);
    const { object, usage: total } = await generateStructured({
      model,
      schema: Schema,
      description: "data",
      system: "extract",
      messages: [{ role: "user", content: "doc" }],
      maxOutputTokens: 1000,
    });
    expect(object).toEqual({ number: 1, name: null });
    expect(model.doGenerateCalls).toHaveLength(2);
    // Both attempts are metered.
    expect(total).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
    });
  });

  it("throws with the spent usage after exhausting attempts", async () => {
    const model = sequenced([textResult("no")]);
    const run = generateStructured({
      model,
      schema: Schema,
      description: "data",
      system: "extract",
      messages: [{ role: "user", content: "doc" }],
      maxOutputTokens: 1000,
      attempts: 2,
    });
    await expect(run).rejects.toBeInstanceOf(StructuredOutputError);
    await run.catch((err: unknown) => {
      expect(
        err instanceof StructuredOutputError && err.usage.inputTokens,
      ).toBe(200);
    });
  });
});
