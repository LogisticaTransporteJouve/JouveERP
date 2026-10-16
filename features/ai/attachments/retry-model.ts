import { APICallError } from "ai";

import type { ChatModel } from "../model";

import { ATTACHMENT_TAG } from "./expand";

// A file the model API refuses (corrupt image, unsupported PDF) must not break
// the session: the call is retried once without the newest tagged attachment,
// which is reported so it is never sent again.

type CallOptions = Parameters<ChatModel["doStream"]>[0];
type Prompt = CallOptions["prompt"];

export const DROPPED_ATTACHMENT_NOTE =
  "(El proveedor de IA no pudo leer este adjunto. Avisale al usuario que no se pudo leer y que pruebe subiéndolo en otro formato.)";

const NOTE_PART: { type: "text"; text: string } = {
  type: "text",
  text: DROPPED_ATTACHMENT_NOTE,
};

/** A non-retryable 400 that names a file, image or document. */
export function isAttachmentRejection(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  if (error.statusCode !== 400 || error.isRetryable) return false;
  const text = `${error.message} ${error.responseBody ?? ""}`;
  return /image|pdf|document|file|media|base64/i.test(text);
}

function taggedId(providerOptions: unknown): string | null {
  if (typeof providerOptions !== "object" || providerOptions === null) {
    return null;
  }
  const tag: unknown = Reflect.get(providerOptions, ATTACHMENT_TAG);
  if (typeof tag !== "object" || tag === null) return null;
  const fileId: unknown = Reflect.get(tag, "fileId");
  return typeof fileId === "string" ? fileId : null;
}

/** File ids of the tagged attachment parts, in prompt order. */
export function taggedFileIds(prompt: Prompt): string[] {
  const ids: string[] = [];
  for (const message of prompt) {
    if (message.role !== "user") continue;
    for (const part of message.content) {
      const id = part.type === "file" ? taggedId(part.providerOptions) : null;
      if (id) ids.push(id);
    }
  }
  return ids;
}

/** The prompt with the given attachments replaced by a note. */
export function dropAttachments(
  prompt: Prompt,
  fileIds: ReadonlySet<string>,
): Prompt {
  if (fileIds.size === 0) return prompt;
  return prompt.map((message) => {
    if (message.role !== "user") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        const id = part.type === "file" ? taggedId(part.providerOptions) : null;
        return id && fileIds.has(id) ? NOTE_PART : part;
      }),
    };
  });
}

/**
 * Wraps the chat model: on an attachment rejection the call is retried once
 * without the newest tagged attachment; every later call of the turn leaves
 * it out too. `onDropped` persists the decision.
 */
export function withAttachmentRetry(
  model: ChatModel,
  onDropped: (fileId: string) => Promise<void>,
): ChatModel {
  const dropped = new Set<string>();
  async function call<R>(
    options: CallOptions,
    run: (o: CallOptions) => PromiseLike<R>,
  ): Promise<R> {
    const prompt = dropAttachments(options.prompt, dropped);
    try {
      return await run({ ...options, prompt });
    } catch (error) {
      const newest = taggedFileIds(prompt).at(-1);
      if (!newest || !isAttachmentRejection(error)) throw error;
      dropped.add(newest);
      await onDropped(newest);
      return run({ ...options, prompt: dropAttachments(prompt, dropped) });
    }
  }
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: (options) => call(options, (o) => model.doGenerate(o)),
    doStream: (options) => call(options, (o) => model.doStream(o)),
  };
}
