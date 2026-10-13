import "server-only";

import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import type { z } from "zod";

import {
  sumUsageTokens,
  usageTokens,
  type AiUsageTokens,
} from "../lib/chat-store";

/** The single tool the model fills in to return its structured answer. */
export const SUBMIT_TOOL_NAME = "submit_result";

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    /** Tokens spent by the failed attempts (still billed — record them). */
    public readonly usage: AiUsageTokens,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/**
 * Structured output through a plain tool with `toolChoice: "auto"`.
 *
 * Why not generateObject: on Claude Sonnet 5.5 a forced tool_choice
 * (`any`/`tool`) is a 400, which is exactly what generateObject's json-tool
 * mode sends; and Anthropic's constrained decoding (`outputFormat`) can't
 * compile our extraction schemas (too many nullable/union fields). So the
 * schema is offered as one tool, the prompt tells the model to call it, the
 * call's input is re-validated with Zod, and a missing/invalid call is retried
 * with a corrective instruction. The tool has no `execute`, so the call is
 * never run — one step only.
 */
export async function generateStructured<T>(opts: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  /** What the tool returns, for its description. */
  description: string;
  system: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
  attempts?: number;
  maxRetries?: number;
}): Promise<{ object: T; usage: AiUsageTokens }> {
  const attempts = opts.attempts ?? 3;
  const usages: AiUsageTokens[] = [];
  let correction = "";
  let lastProblem = "no attempt";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const messages: ModelMessage[] = correction
      ? [...opts.messages, { role: "user", content: correction }]
      : opts.messages;
    const result = await generateText({
      model: opts.model,
      system:
        `${opts.system}\n\nReturn your answer ONLY by calling the ` +
        `"${SUBMIT_TOOL_NAME}" tool exactly once with the complete data.`,
      messages,
      tools: {
        [SUBMIT_TOOL_NAME]: tool({
          description: opts.description,
          inputSchema: opts.schema,
        }),
      },
      toolChoice: "auto",
      stopWhen: stepCountIs(1),
      maxOutputTokens: opts.maxOutputTokens,
      maxRetries: opts.maxRetries ?? 2,
      providerOptions: opts.providerOptions,
    });
    usages.push(usageTokens(result.totalUsage));

    const call = result.toolCalls.find((c) => c.toolName === SUBMIT_TOOL_NAME);
    if (!call) {
      lastProblem = `no ${SUBMIT_TOOL_NAME} call (finish: ${result.finishReason})`;
      correction = `You did not call the "${SUBMIT_TOOL_NAME}" tool. Call it now with the data; do not answer in text.`;
      continue;
    }
    const parsed = opts.schema.safeParse(call.input);
    if (!parsed.success) {
      lastProblem = `invalid ${SUBMIT_TOOL_NAME} input: ${parsed.error.message}`;
      correction = `Your "${SUBMIT_TOOL_NAME}" call did not match the schema (${parsed.error.issues[0]?.message ?? "invalid"}). Call it again with valid data.`;
      continue;
    }
    return { object: parsed.data, usage: sumUsageTokens(usages) };
  }
  throw new StructuredOutputError(
    `structured output failed after ${attempts} attempts: ${lastProblem}`,
    sumUsageTokens(usages),
  );
}
