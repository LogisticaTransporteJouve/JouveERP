import { anthropic } from "@ai-sdk/anthropic";

/**
 * Chat + insights model: Claude Sonnet 4.6 (docs/ai-overview.md §1 — best
 * tool-use/cost; Opus 4.8 reserved as an optional future escalation).
 */
export const AI_CHAT_MODEL = "claude-sonnet-4-6";

/** Small/cheap tasks: chat-title generation, document classification. */
export const AI_TITLE_MODEL = "claude-haiku-4-5";

/**
 * Central model factory. The Anthropic provider reads ANTHROPIC_API_KEY from
 * the environment at request time (lazy — no key needed to build the handle).
 *
 * Provider fallback (Gemini via @ai-sdk/google, GPT via @ai-sdk/openai — both
 * installed in AI.0) is a thin wrapper to add here later; the MVP runs the
 * primary provider only.
 */
export function buildChatModel() {
  return anthropic(AI_CHAT_MODEL);
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
