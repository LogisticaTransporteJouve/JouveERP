// Tool-call repair for the chat agent (modeled on Sumary's
// packages/shared/src/repair-tool-call.ts + ai-agent/repair-tool-call.ts).
//
// When the model mis-fills a tool's arguments the AI SDK does NOT drop the call:
// it echoes the invalid tool_use (non-object input) back on the next step,
// which Anthropic rejects (`tool_use.input: Input should be an object`) and the
// whole turn dies. `experimental_repairToolCall` is the only hook that runs
// before that echo. On an invalid-input error we regenerate schema-valid
// arguments with the cheap utility model (Haiku), bounded in context and time;
// if that fails (or there is no intent to recover) we return the smallest
// schema-valid object so the call degrades to a harmless no-op query instead
// of killing the turn. Every chat tool is read-only, so a no-op is safe.

import {
  generateObject,
  InvalidToolInputError,
  jsonSchema,
  type JSONSchema7,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

import { logger } from "@/lib/logger";

import { AI_SMALL_MAX_OUTPUT_TOKENS, buildRepairModel } from "../model";

/** Wall-clock bound: the SDK doesn't pass the stream's abort signal to repair. */
export const REPAIR_TIMEOUT_MS = 15_000;
/** Recent messages forwarded to the repair model (intent, not the transcript). */
export const REPAIR_CONTEXT_MESSAGES = 12;

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The tail of the conversation, minus system messages (the repair call has its
 * own) and minus any leading tool results whose tool call fell outside the
 * window (the provider 400s on an orphaned tool_result).
 */
export function boundRepairContext(messages: ModelMessage[]): ModelMessage[] {
  const tail = messages
    .filter((m) => m.role !== "system")
    .slice(-REPAIR_CONTEXT_MESSAGES);
  let start = 0;
  while (start < tail.length && tail[start]?.role === "tool") start++;
  return tail.slice(start);
}

/**
 * True when the mis-filled input carries intent to recover. Empty containers /
 * null / "" have none — regenerating from nothing would fabricate arguments.
 * Unparseable (truncated) JSON does carry partial intent.
 */
export function hasRecoverableInput(raw: string): boolean {
  const t = raw.trim();
  if (t === "") return false;
  try {
    const parsed: unknown = JSON.parse(t);
    if (parsed === null || parsed === "") return false;
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (isRecord(parsed)) return Object.keys(parsed).length > 0;
    return true;
  } catch {
    return true;
  }
}

function emptyForSchema(propSchema: unknown): unknown {
  const type = isRecord(propSchema) ? propSchema.type : undefined;
  switch (type) {
    case "array":
      return [];
    case "object":
      return {};
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

/** Smallest object filling a JSON schema's required fields with empty values. */
export function minimalValidInstance(schema: unknown): JsonObject {
  if (!isRecord(schema)) return {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const out: JsonObject = {};
  for (const key of required) {
    if (typeof key === "string") out[key] = emptyForSchema(properties[key]);
  }
  return out;
}

export type RegenerateArgs = (args: {
  toolName: string;
  inputSchema: JSONSchema7;
  invalidInput: string;
  errorMessage: string;
  messages: ModelMessage[];
}) => Promise<JsonObject | null>;

/** Default regenerator: Haiku, bounded context, hard timeout. */
export function haikuRegenerator(opts: {
  onUsage?: (usage: LanguageModelUsage) => void | Promise<void>;
}): RegenerateArgs {
  return async ({
    toolName,
    inputSchema,
    invalidInput,
    errorMessage,
    messages,
  }) => {
    try {
      const { object, usage } = await generateObject({
        model: buildRepairModel(),
        schema: jsonSchema(inputSchema),
        maxOutputTokens: AI_SMALL_MAX_OUTPUT_TOKENS,
        providerOptions: { anthropic: { effort: "low" } },
        abortSignal: AbortSignal.timeout(REPAIR_TIMEOUT_MS),
        system:
          `You are repairing a malformed call to the "${toolName}" tool in an ` +
          "ongoing conversation with an accounting ERP assistant. Using the " +
          "conversation so far, produce corrected arguments that satisfy the " +
          "tool's schema and preserve what the assistant was trying to do. Do " +
          "not invent details the conversation does not support.",
        messages: [
          ...boundRepairContext(messages),
          {
            role: "user",
            content:
              `The last "${toolName}" tool call was rejected: ${errorMessage}\n\n` +
              `Invalid arguments:\n${invalidInput.slice(0, 4_000)}\n\n` +
              "Return corrected arguments only.",
          },
        ],
      });
      await opts.onUsage?.(usage);
      return isRecord(object) ? object : null;
    } catch (err) {
      logger.warn("ai.repair_tool_call.failed", {
        toolName,
        // name only — never the raw invalid input.
        error: err instanceof Error ? err.name : String(err),
      });
      return null;
    }
  };
}

/** Builds the `experimental_repairToolCall` callback. */
export function makeRepairToolCall<TOOLS extends ToolSet>(
  regenerate: RegenerateArgs,
): ToolCallRepairFunction<TOOLS> {
  return async ({ toolCall, inputSchema, error, messages }) => {
    // Unknown tool names can't be regenerated against a schema.
    if (!InvalidToolInputError.isInstance(error)) return null;

    const schema = await inputSchema({ toolName: toolCall.toolName });
    const recoverable = hasRecoverableInput(toolCall.input);
    const repaired = recoverable
      ? await regenerate({
          toolName: toolCall.toolName,
          inputSchema: schema,
          invalidInput: toolCall.input,
          errorMessage: error.message,
          messages,
        })
      : null;

    logger.info("ai.repair_tool_call", {
      toolName: toolCall.toolName,
      outcome: repaired
        ? "regenerated"
        : recoverable
          ? "regeneration-failed-noop"
          : "empty-input-noop",
    });

    const input = repaired ?? minimalValidInstance(schema);
    return { ...toolCall, input: JSON.stringify(input) };
  };
}
