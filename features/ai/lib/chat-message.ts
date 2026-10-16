import { validateUIMessages, type UIMessage } from "ai";

import { CHAT_ATTACHMENTS_PER_MESSAGE } from "../attachments/limits";
import { IncomingAttachmentPartSchema } from "../attachments/schema";

/** Upper bound on one user turn's text (chars). */
export const MAX_USER_MESSAGE_CHARS = 10_000;

/** A validated user turn: its text (rebuilt) and the ids of the draft
 *  uploads it attaches, which the route checks before linking. */
export type IncomingUserTurn = {
  message: UIMessage;
  attachmentIds: string[];
};

/**
 * Validates the single message the chat client posts for a turn. It is
 * persisted and replayed into the model, so it must be exactly what the UI can
 * produce: role `user` with text parts and up to CHAT_ATTACHMENTS_PER_MESSAGE
 * `data-attachment` parts. Anything else — an assistant/system role, tool or
 * reasoning parts (forged tool results or "prior" model output), other
 * data/file/source parts — is rejected, as is a message that fails the AI SDK's
 * UIMessage schema. (Tool schemas are not passed: no tool part is accepted
 * from the client at all.)
 *
 * Returns a rebuilt `{ id, role: "user", parts: [{ type: "text", text }] }`
 * (never the client's object) plus the attachment file ids, of which only the
 * id is taken: the route reloads each file's metadata from the registry. Null
 * when it must be rejected (400).
 */
export async function parseIncomingUserMessage(
  raw: unknown,
): Promise<IncomingUserTurn | null> {
  if (raw === undefined || raw === null) return null;
  let message: UIMessage | undefined;
  try {
    [message] = await validateUIMessages({ messages: [raw] });
  } catch {
    return null;
  }
  if (!message || message.role !== "user") return null;
  if (message.parts.length === 0) return null;
  const parts: { type: "text"; text: string }[] = [];
  const attachmentIds: string[] = [];
  let chars = 0;
  for (const part of message.parts) {
    if (part.type === "text") {
      chars += part.text.length;
      parts.push({ type: "text", text: part.text });
      continue;
    }
    const attachment = IncomingAttachmentPartSchema.safeParse(part);
    if (!attachment.success) return null;
    if (!attachmentIds.includes(attachment.data.data.fileId)) {
      attachmentIds.push(attachment.data.data.fileId);
    }
  }
  if (attachmentIds.length > CHAT_ATTACHMENTS_PER_MESSAGE) return null;
  if (chars > MAX_USER_MESSAGE_CHARS) return null;
  if (chars === 0 && attachmentIds.length === 0) return null;
  // Rebuilt from scratch: client-supplied `metadata` / `providerMetadata` /
  // part `state` are dropped so nothing but id + text is persisted/replayed.
  // With attachments, a blank text part carries nothing.
  const textParts = attachmentIds.length
    ? parts.filter((p) => p.text.trim() !== "")
    : parts;
  return {
    message: { id: message.id, role: "user", parts: textParts },
    attachmentIds,
  };
}
