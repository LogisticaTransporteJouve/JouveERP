import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import type { ChatModel } from "../model";

import type { StoredAttachment } from "./content";
import { ATTACHMENT_TAG } from "./expand";
import {
  DROPPED_ATTACHMENT_NOTE,
  isAttachmentRejection,
  withAttachmentRetry,
} from "./retry-model";
import { buildOpenAttachmentTool } from "./tool";

const FILE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function row(extra: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    fileId: FILE,
    mimeType: "application/pdf",
    size: 10,
    pages: 2,
    rows: null,
    table: null,
    unreadable: false,
    bucket: "files",
    bucketPath: `${FILE}.pdf`,
    ...extra,
  };
}

const options = { toolCallId: "call-1", messages: [], context: {} };

describe("openAttachment", () => {
  it("loads a session file once and hands the model its bytes", async () => {
    const download = vi.fn(async () => new TextEncoder().encode("%PDF"));
    const open = buildOpenAttachmentTool({
      stored: new Map([[FILE, row()]]),
      filenames: new Map([[FILE, "factura.pdf"]]),
      download,
    });
    const output = await open.execute?.({ fileId: FILE }, options);
    expect(output).toMatchObject({
      ok: true,
      data: { fileId: FILE, filename: "factura.pdf" },
    });
    // The persisted output is a receipt, never the bytes.
    expect(JSON.stringify(output)).not.toContain("JVBER");
    const model = await open.toModelOutput?.({
      toolCallId: "call-1",
      input: { fileId: FILE },
      output,
    });
    expect(model).toMatchObject({
      type: "content",
      value: [
        { type: "text" },
        {
          type: "file",
          mediaType: "application/pdf",
          data: { type: "data", data: Buffer.from("%PDF").toString("base64") },
        },
      ],
    });
    // Replayed in a later turn (another call id): a note, not the file.
    const replay = await open.toModelOutput?.({
      toolCallId: "old-call",
      input: { fileId: FILE },
      output,
    });
    expect(replay).toMatchObject({ type: "text" });
  });

  it("refuses files outside the session and past the budget", async () => {
    const open = buildOpenAttachmentTool({
      stored: new Map([[FILE, row({ size: 900 })]]),
      filenames: new Map([[FILE, "factura.pdf"]]),
      download: async () => new Uint8Array(),
      used: { bytes: 200, pdfPages: 0 },
      budget: { files: 8, bytes: 1000, pdfPages: 40, tableChars: 1000 },
    });
    expect(await open.execute?.({ fileId: OTHER }, options)).toMatchObject({
      ok: false,
    });
    expect(await open.execute?.({ fileId: FILE }, options)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no entra"),
    });
  });
});

type Prompt = Parameters<ChatModel["doStream"]>[0]["prompt"];

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function rejection(message: string, status = 400) {
  return new APICallError({
    message,
    url: "https://api",
    requestBodyValues: {},
    statusCode: status,
    isRetryable: status >= 500,
  });
}

describe("withAttachmentRetry", () => {
  const prompt: Prompt = [
    {
      role: "user",
      content: [
        { type: "text", text: "mirá" },
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: "AAAA" },
          providerOptions: { [ATTACHMENT_TAG]: { fileId: FILE } },
        },
      ],
    },
  ];

  it("retries once without the newest attachment and reports it", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        if (calls === 1) throw rejection("messages.0: Could not process image");
        return {
          stream: simulateReadableStream({
            chunks: [
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "end_turn" },
                usage,
              },
            ],
          }),
        };
      },
    });
    const dropped = vi.fn(async () => undefined);
    const wrapped = withAttachmentRetry(model, dropped);
    await wrapped.doStream({ prompt });
    expect(dropped).toHaveBeenCalledWith(FILE);
    const retried = model.doStreamCalls[1]?.prompt[0];
    expect(retried?.content).toEqual([
      { type: "text", text: "mirá" },
      { type: "text", text: DROPPED_ATTACHMENT_NOTE },
    ]);
    // Later steps of the turn leave it out without failing first.
    await wrapped.doStream({ prompt });
    expect(model.doStreamCalls[2]?.prompt[0]?.content).toHaveLength(2);
  });

  it("lets other errors through", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw rejection("max_tokens too large");
      },
    });
    const dropped = vi.fn(async () => undefined);
    await expect(
      withAttachmentRetry(model, dropped).doStream({ prompt }),
    ).rejects.toThrow("max_tokens");
    expect(dropped).not.toHaveBeenCalled();
    expect(isAttachmentRejection(rejection("image too big", 529))).toBe(false);
  });
});
