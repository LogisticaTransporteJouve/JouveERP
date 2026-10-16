import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { APICallError } from "ai";

import { logger } from "@/lib/logger";

/**
 * Chat + extraction model: Claude Sonnet 5.5 (docs/ai-overview.md §1 — best
 * tool-use/cost; Claude Opus 5.5 reserved as an optional future escalation).
 *
 * Notes for the 5.5 family (vs the 4.x models this replaced):
 * - @ai-sdk/anthropic knows these ids, so it would default max_tokens to the
 *   model ceiling (128K) and pick native structured outputs (constrained
 *   decoding) for generateObject: every call site sets `maxOutputTokens`
 *   explicitly, and Haiku generateObject calls pin `structuredOutputMode:
 *   "jsonTool"`.
 * - Sonnet 5.5 rejects a forced tool_choice (`any` / `tool`) with a 400, so
 *   generateObject's json-tool mode can't run on it (document/structured.ts).
 *   Haiku 5.5 still accepts a forced tool_choice.
 * - Adaptive thinking is on by default; depth is set with `effort`.
 * - Non-default temperature / top_p / top_k return a 400 — don't set them.
 */
export const AI_CHAT_MODEL = "claude-sonnet-5-5";

/** Small/cheap tasks: chat titles, document classification, tool repair. */
export const AI_TITLE_MODEL = "claude-haiku-5-5";

/** Output ceilings (thinking + reply share max_tokens on the 5.5 family). */
export const AI_CHAT_MAX_OUTPUT_TOKENS = 16_000;
export const AI_EXTRACTION_MAX_OUTPUT_TOKENS = 16_000;
export const AI_SMALL_MAX_OUTPUT_TOKENS = 2_000;

/**
 * Fallback provider models. Only used if the matching API key is set; the
 * exact Gemini/GPT ids drift, so they are env-overridable.
 */
const AI_FALLBACK_GOOGLE_MODEL =
  process.env.AI_FALLBACK_GOOGLE_MODEL ?? "gemini-pro-latest";
const AI_FALLBACK_OPENAI_MODEL =
  process.env.AI_FALLBACK_OPENAI_MODEL ?? "gpt-5.2";

export type ChatModel = ReturnType<typeof anthropic>;

/**
 * Retryable = provider-side / transient (5xx, 429, connection). 4xx/validation
 * and non-API errors propagate so we don't burn the fallback budget on a bug or
 * a bad request. Reuses the SDK's own `isRetryable` classification.
 */
export function isRetryableModelError(error: unknown): boolean {
  return APICallError.isInstance(error) ? error.isRetryable : false;
}

/**
 * Runs attempts in order, advancing to the next on a retryable error. The last
 * attempt's error (or the first non-retryable one) propagates.
 */
export async function runWithFallback<T>(
  attempts: Array<() => Promise<T>>,
  opts: {
    onFallback?: (fromIndex: number, error: unknown) => void;
    isRetryable?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const retryable = opts.isRetryable ?? isRetryableModelError;
  let lastError: unknown;
  for (const [i, attempt] of attempts.entries()) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (i === attempts.length - 1 || !retryable(error)) throw error;
      opts.onFallback?.(i, error);
    }
  }
  throw lastError;
}

/**
 * Wraps an ordered list of models so a transient failure on one rotates to the
 * next provider. Identity/metadata is delegated to the primary (first) model.
 *
 * Sticky: once a call is served by a fallback link, every later call on this
 * instance starts from that link. One instance is built per chat turn
 * (buildChatModel), so a turn that fell back keeps the fallback provider for
 * the rest of its tool-loop steps — the step history now carries that
 * provider's artifacts, and bouncing back to Anthropic mid-loop would replay a
 * foreign transcript (Anthropic 400s on a tool_use turn missing its own
 * thinking block). The next turn builds a fresh instance and tries the
 * primary again.
 */
export function createFallbackModel(
  primary: ChatModel,
  models: ChatModel[],
  onServed: (modelId: string) => void,
): ChatModel {
  let start = 0;
  function chain<R>(call: (m: ChatModel) => PromiseLike<R>): Promise<R> {
    const offset = start;
    return runWithFallback(
      models.slice(offset).map((m, i) => async () => {
        const result = await call(m);
        start = Math.max(start, offset + i);
        onServed(m.modelId);
        return result;
      }),
      {
        onFallback: (fromIndex, error) =>
          logger.warn("ai.model_fallback", {
            failed: models[offset + fromIndex]?.modelId,
            next: models[offset + fromIndex + 1]?.modelId,
            attempt: offset + fromIndex + 1,
            error: error instanceof Error ? error.message : String(error),
          }),
      },
    );
  }
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate: (options) => chain((m) => m.doGenerate(options)),
    doStream: (options) => chain((m) => m.doStream(options)),
  };
}

/**
 * Central chat model. Primary = Claude Sonnet 5.5. If GOOGLE and/or OPENAI
 * keys are present, wraps them as an ordered, per-turn sticky fallback chain
 * (Anthropic → Gemini → GPT) so a single-vendor outage doesn't take the agent
 * down. With no fallback keys set it returns the Anthropic model unchanged.
 * Build one per turn.
 */
export function buildChatModel(): {
  model: ChatModel;
  /** The model id that actually served the last call (for usage metering). */
  servedModel: () => string;
} {
  const primary = anthropic(AI_CHAT_MODEL);
  const models: ChatModel[] = [primary];
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    models.push(google(AI_FALLBACK_GOOGLE_MODEL));
  }
  if (process.env.OPENAI_API_KEY) {
    models.push(openai(AI_FALLBACK_OPENAI_MODEL));
  }
  if (models.length === 1) {
    return { model: primary, servedModel: () => primary.modelId };
  }
  let served = primary.modelId;
  const model = createFallbackModel(primary, models, (id) => {
    served = id;
  });
  return { model, servedModel: () => served };
}

/** Cheap model for chat-title autogeneration (first turn). */
export function buildTitleModel() {
  return anthropic(AI_TITLE_MODEL);
}

/** Cheap model for regenerating mis-filled tool-call arguments. */
export function buildRepairModel() {
  return anthropic(AI_TITLE_MODEL);
}

/**
 * Document Intelligence models (docs/ai-overview.md §5-bis): Haiku classifies
 * (short factual task, much cheaper), Sonnet extracts (amount/item precision
 * matters). Both are vision/PDF-capable.
 */
export function buildClassifierModel() {
  return anthropic(AI_TITLE_MODEL);
}

export function buildExtractionModel() {
  return anthropic(AI_CHAT_MODEL);
}
