import { simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaimResult } from "@/features/ai/attachments/store";
import type { StoredAttachment } from "@/features/ai/attachments/content";
import { resolveAccess } from "@/lib/auth/permissions";

const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILE_ID = "11111111-1111-4111-8111-111111111111";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
let model = new MockLanguageModelV4();

const store = {
  claimDraftAttachments: vi.fn<() => Promise<ClaimResult>>(),
  linkAttachmentsToMessage: vi.fn(async () => undefined),
  listSessionAttachments: vi.fn(
    async () => new Map<string, StoredAttachment>(),
  ),
  downloadStoredFile: vi.fn(async () => new TextEncoder().encode("%PDF-1.4")),
  markAttachmentUnreadable: vi.fn(async () => undefined),
};
let prior: UIMessage[] = [];
const chatStore = {
  appendAiMessage: vi.fn<
    (sessionId: string, message: UIMessage) => Promise<string>
  >(async () => "row-1"),
  deleteAiMessageRow: vi.fn(async () => undefined),
};

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u-owner",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  RateLimitError: class extends Error {},
  enforceRateLimit: async () => undefined,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: async () => undefined }));
vi.mock("@/features/ai/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai/model")>()),
  buildChatModel: () => ({ model, servedModel: () => "claude-sonnet-5-5" }),
}));
vi.mock("@/features/ai/lib/chat-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai/lib/chat-store")>()),
  getAiUsageToday: async () => ({ totalTokens: 0, costUsd: 0 }),
  ensureAiSession: async () => ({ created: false }),
  loadAiSessionMessages: async () => prior,
  appendAiMessage: chatStore.appendAiMessage,
  deleteAiMessageRow: chatStore.deleteAiMessageRow,
  recordAiUsage: async () => undefined,
  maybeTitleAiSession: async () => undefined,
}));
vi.mock("@/features/ai/lib/confirmations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai/lib/confirmations")>()),
  listSessionConfirmations: async () => [],
}));
vi.mock("@/features/ai/attachments/store", () => store);

const { POST } = await import("./route");

function post(message: unknown): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION, message }),
  });
}

const clientMessage = {
  id: "m1",
  role: "user",
  parts: [
    {
      type: "data-attachment",
      id: FILE_ID,
      // The client's metadata is ignored: the registry's wins.
      data: {
        fileId: FILE_ID,
        filename: "falso.exe",
        mimeType: "x/y",
        size: 1,
      },
    },
    { type: "text", text: "¿Qué es esto?" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  store.claimDraftAttachments.mockResolvedValue({
    ok: true,
    attachments: [
      {
        fileId: FILE_ID,
        filename: "factura.pdf",
        mimeType: "application/pdf",
        size: 8,
      },
    ],
  });
  store.listSessionAttachments.mockResolvedValue(
    new Map([
      [
        FILE_ID,
        {
          fileId: FILE_ID,
          mimeType: "application/pdf",
          size: 8,
          pages: 1,
          rows: null,
          table: null,
          unreadable: false,
          bucket: "files",
          bucketPath: `${FILE_ID}.pdf`,
        },
      ],
    ]),
  );
  model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Es una factura." },
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "end_turn" },
            usage,
          },
        ],
      }),
    }),
  });
});

describe("POST /api/ai/chat with attachments", () => {
  it("persists registry metadata, links the files and sends them to the model", async () => {
    const res = await POST(post(clientMessage));
    expect(res.status).toBe(200);
    await res.text();

    expect(store.claimDraftAttachments).toHaveBeenCalledWith("u-owner", [
      FILE_ID,
    ]);
    const persisted = chatStore.appendAiMessage.mock.calls[0];
    const message: UIMessage | undefined = persisted?.[1];
    expect(message?.parts).toEqual([
      {
        type: "data-attachment",
        id: FILE_ID,
        data: {
          fileId: FILE_ID,
          filename: "factura.pdf",
          mimeType: "application/pdf",
          size: 8,
        },
      },
      { type: "text", text: "¿Qué es esto?" },
    ]);
    expect(store.linkAttachmentsToMessage).toHaveBeenCalledWith(
      "u-owner",
      "row-1",
      [FILE_ID],
    );
    expect(store.listSessionAttachments).toHaveBeenCalledWith(SESSION);

    const user = model.doStreamCalls[0]?.prompt.find((m) => m.role === "user");
    if (user?.role !== "user") throw new Error("no user message");
    expect(user.content.map((p) => p.type)).toEqual(["text", "file", "text"]);
    expect(user.content[0]).toMatchObject({
      text: expect.stringContaining(
        "<attachment_name>factura.pdf</attachment_name>",
      ),
    });
  });

  it("refuses files the caller cannot claim, before persisting", async () => {
    store.claimDraftAttachments.mockResolvedValue({
      ok: false,
      error: "Un adjunto ya no está disponible. Volvé a subirlo.",
    });
    const res = await POST(post(clientMessage));
    expect(res.status).toBe(409);
    expect(chatStore.appendAiMessage).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("rolls the message back when a file was linked meanwhile", async () => {
    store.linkAttachmentsToMessage.mockRejectedValueOnce({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    const res = await POST(post(clientMessage));
    expect(res.status).toBe(409);
    expect(chatStore.deleteAiMessageRow).toHaveBeenCalledWith(SESSION, "row-1");
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("answers 503 (not 'already sent') on a transient link failure", async () => {
    store.linkAttachmentsToMessage.mockRejectedValueOnce(new Error("timeout"));
    chatStore.deleteAiMessageRow.mockRejectedValueOnce(new Error("down"));
    const res = await POST(post(clientMessage));
    expect(res.status).toBe(503);
    expect(chatStore.deleteAiMessageRow).toHaveBeenCalledWith(SESSION, "row-1");
  });

  it("sends an earlier attachment as a note and offers openAttachment", async () => {
    store.claimDraftAttachments.mockResolvedValue({
      ok: true,
      attachments: [],
    });
    prior = [
      {
        id: "u0",
        role: "user",
        parts: [
          {
            type: "data-attachment",
            id: FILE_ID,
            data: {
              fileId: FILE_ID,
              filename: "factura.pdf",
              mimeType: "application/pdf",
              size: 8,
            },
          },
        ],
      },
      { id: "a0", role: "assistant", parts: [{ type: "text", text: "ok" }] },
    ];
    try {
      const res = await POST(
        post({
          id: "m3",
          role: "user",
          parts: [{ type: "text", text: "¿y el total?" }],
        }),
      );
      await res.text();
      const call = model.doStreamCalls[0];
      const first = call?.prompt.find((m) => m.role === "user");
      if (first?.role !== "user") throw new Error("no user message");
      expect(first.content.map((p) => p.type)).toEqual(["text"]);
      expect(first.content[0]).toMatchObject({
        text: expect.stringContaining("openAttachment"),
      });
      expect(store.downloadStoredFile).not.toHaveBeenCalled();
      expect(call?.tools?.some((t) => t.name === "openAttachment")).toBe(true);
    } finally {
      prior = [];
    }
  });

  it("keeps plain text turns working without touching the registry", async () => {
    const res = await POST(
      post({ id: "m2", role: "user", parts: [{ type: "text", text: "hola" }] }),
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(store.claimDraftAttachments).toHaveBeenCalledWith("u-owner", []);
    expect(store.linkAttachmentsToMessage).toHaveBeenCalledWith(
      "u-owner",
      "row-1",
      [],
    );
  });
});
