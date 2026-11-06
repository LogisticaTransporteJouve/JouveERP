import type { ModelMessage, ToolResultPart } from "ai";

import { clipText } from "../registry/result";

/** Characters of an earlier turn's tool result the model reads again. */
export const HISTORY_RESULT_MAX_CHARS = 6_000;

/** Characters of an earlier turn's tool call input the model reads again. */
export const HISTORY_INPUT_MAX_CHARS = 2_000;

type ToolOutput = ToolResultPart["output"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An artifact the user already sees in the panel: the model keeps what it
 *  said about it, not its rows. */
function withoutShownRows(output: ToolOutput): ToolOutput {
  if (output.type !== "json" || !isRecord(output.value)) return output;
  const rest = Object.fromEntries(
    Object.entries(output.value).filter(
      ([key]) => key !== "data" && key !== "listsCut" && key !== "listsCutNote",
    ),
  );
  return { type: "json", value: rest };
}

function clipOutput(output: ToolOutput): ToolOutput {
  if (output.type === "json") {
    const text = JSON.stringify(output.value);
    return text.length <= HISTORY_RESULT_MAX_CHARS
      ? output
      : { type: "text", value: clipText(text, HISTORY_RESULT_MAX_CHARS) };
  }
  if (output.type === "text" || output.type === "error-text") {
    return {
      ...output,
      value: clipText(output.value, HISTORY_RESULT_MAX_CHARS),
    };
  }
  return output;
}

function clipInput(input: unknown): unknown {
  const text = JSON.stringify(input) ?? "";
  return text.length <= HISTORY_INPUT_MAX_CHARS
    ? input
    : { recortado: clipText(text, HISTORY_INPUT_MAX_CHARS) };
}

/**
 * Earlier turns as the model reads them again: user and assistant text as
 * is, each tool result clipped to HISTORY_RESULT_MAX_CHARS and each tool call
 * input to HISTORY_INPUT_MAX_CHARS («…[recortado: N caracteres]»), and the
 * rows of tables, charts and calendars already shown (`shownTools`) dropped.
 * The current turn — from the last user message on — is untouched. Pure and
 * deterministic, so a turn compacts the same way every time it is replayed
 * and the cached history prefix holds.
 */
export function compactHistory(
  messages: ModelMessage[],
  shownTools: ReadonlySet<string>,
): ModelMessage[] {
  const current = messages.findLastIndex((m) => m.role === "user");
  if (current <= 0) return messages;
  return messages.map((message, index): ModelMessage => {
    if (index >= current) return message;
    if (message.role === "tool") {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "tool-result"
            ? {
                ...part,
                output: clipOutput(
                  shownTools.has(part.toolName)
                    ? withoutShownRows(part.output)
                    : part.output,
                ),
              }
            : part,
        ),
      };
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "tool-call"
            ? { ...part, input: clipInput(part.input) }
            : part,
        ),
      };
    }
    return message;
  });
}
