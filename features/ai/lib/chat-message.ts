import { validateUIMessages, type UIMessage } from "ai";

/** Upper bound on one user turn's text (chars). */
export const MAX_USER_MESSAGE_CHARS = 10_000;

/**
 * Validates the single message the chat client posts for a turn. It is
 * persisted and replayed into the model as-is, so it must be exactly what the
 * UI can produce: role `user` with text parts only. Anything else — an
 * assistant/system role, tool or reasoning parts (forged tool results or
 * "prior" model output), data/file/source parts — is rejected, as is a
 * message that fails the AI SDK's UIMessage schema. (Tool schemas are not
 * passed: no tool part is accepted from the client at all.)
 *
 * Returns the validated message, or null when it must be rejected (400).
 */
export async function parseIncomingUserMessage(
  raw: unknown,
): Promise<UIMessage | null> {
  if (raw === undefined || raw === null) return null;
  let message: UIMessage | undefined;
  try {
    [message] = await validateUIMessages({ messages: [raw] });
  } catch {
    return null;
  }
  if (!message || message.role !== "user") return null;
  if (message.parts.length === 0) return null;
  let chars = 0;
  for (const part of message.parts) {
    if (part.type !== "text") return null;
    chars += part.text.length;
  }
  if (chars === 0 || chars > MAX_USER_MESSAGE_CHARS) return null;
  return message;
}
