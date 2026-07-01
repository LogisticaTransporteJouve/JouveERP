import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { APICallError } from "ai";

import { logger } from "@/lib/logger";

/**
 * Chat + insights model: Claude Sonnet 4.6 (docs/ai-overview.md §1 — best
 * tool-use/cost; Opus 4.8 reserved as an optional future escalation).
 */
export const AI_CHAT_MODEL = "claude-sonnet-4-6";

/** Small/cheap tasks: chat-title generation, document classification. */
export const AI_TITLE_MODEL = "claude-haiku-4-5";

/**
 * Fallback provider models. Only used if the matching API key is set; the
 * exact Gemini/GPT ids drift, so they are env-overridable.
 */
const AI_FALLBACK_GOOGLE_MODEL =
  process.env.AI_FALLBACK_GOOGLE_MODEL ?? "gemini-pro-latest";
const AI_FALLBACK_OPENAI_MODEL =
  process.env.AI_FALLBACK_OPENAI_MODEL ?? "gpt-5.2";

type ChatModel = ReturnType<typeof anthropic>;

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
 */
function createFallbackModel(primary: ChatModel, models: ChatModel[]): ChatModel {
  const onFallback = (fromIndex: number, error: unknown) =>
    logger.warn("ai.model_fallback", {
      failed: models[fromIndex]?.modelId,
      next: models[fromIndex + 1]?.modelId,
      attempt: fromIndex + 1,
      error: error instanceof Error ? error.message : String(error),
    });
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate: (options) =>
      runWithFallback(
        models.map((m) => () => Promise.resolve(m.doGenerate(options))),
        { onFallback },
      ),
    doStream: (options) =>
      runWithFallback(
        models.map((m) => () => Promise.resolve(m.doStream(options))),
        { onFallback },
      ),
  };
}

/**
 * Central chat/insights model. Primary = Claude Sonnet 4.6. If GOOGLE and/or
 * OPENAI keys are present, wraps them as an ordered fallback chain
 * (Anthropic → Gemini → GPT) so a single-vendor outage doesn't take the agent
 * down. With no fallback keys set it returns the Anthropic model unchanged
 * (identical behaviour to before).
 */
export function buildChatModel(): ChatModel {
  const primary = anthropic(AI_CHAT_MODEL);
  const models: ChatModel[] = [primary];
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    models.push(google(AI_FALLBACK_GOOGLE_MODEL));
  }
  if (process.env.OPENAI_API_KEY) {
    models.push(openai(AI_FALLBACK_OPENAI_MODEL));
  }
  return models.length === 1 ? primary : createFallbackModel(primary, models);
}

/** Cheap model for chat-title autogeneration (first turn). */
export function buildTitleModel() {
  return anthropic(AI_TITLE_MODEL);
}

/**
 * Document Intelligence models (docs/ai-overview.md §5-bis): Haiku classifies
 * (short factual task, ~10× cheaper), Sonnet extracts (amount/item precision
 * matters). Both are vision/PDF-capable.
 */
export function buildClassifierModel() {
  return anthropic(AI_TITLE_MODEL);
}

export function buildExtractionModel() {
  return anthropic(AI_CHAT_MODEL);
}
