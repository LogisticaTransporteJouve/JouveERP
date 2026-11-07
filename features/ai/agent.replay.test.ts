import {
  createUIMessageStream,
  readUIMessageStream,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { AttachmentContents } from "./attachments/expand";

// A whole chat session through the real request path (convert → clip →
// turn context → cache breakpoints → @ai-sdk/anthropic) against a fetch that
// records each Anthropic request body and answers with canned SSE.

const ACCOUNTS = Array.from({ length: 80 }, (_, i) => ({
  id: `acc-${i}`,
  // ~25 rows of these fit the model view (10K chars) but not the 6K a
  // replayed result keeps.
  name: `Cuenta bancaria número ${i} `.padEnd(300, "x"),
  currency: i % 2 ? "USD" : "ARS",
  is_active: true,
}));

vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: async () => ({ ok: true, data: ACCOUNTS }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

type Sse = Record<string, unknown>;
type Body = { messages: { role: string; content: Block[] }[] };
type Block = Record<string, unknown> & { type: string };

const replies: Sse[][] = [];
const requests: Body[] = [];

const usage = {
  input_tokens: 90_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: {
    ephemeral_5m_input_tokens: 0,
    ephemeral_1h_input_tokens: 0,
  },
  output_tokens: 1,
  service_tier: "standard",
};

function start(id: string): Sse {
  return {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [],
      stop_reason: null,
      usage,
    },
  };
}

/** A step that thinks (display omitted: empty text, signature only) and
 *  calls one tool. */
function toolReply(id: string, name: string, input: unknown): Sse[] {
  return [
    start(`msg_${id}`),
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: `sig_${id}` },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id,
        name,
        input: {},
        caller: { type: "direct" },
      },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 50 },
    },
    { type: "message_stop" },
  ];
}

function textReply(text: string): Sse[] {
  return [
    start("msg_text"),
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    },
    { type: "message_stop" },
  ];
}

const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
  requests.push(JSON.parse(String(init?.body)));
  const reply = replies.shift();
  if (!reply) throw new Error("unexpected model call");
  const body = reply
    .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
});

// The production model (buildChatModel → @ai-sdk/anthropic), Anthropic only.
vi.stubGlobal("fetch", fetchMock);
vi.stubEnv("ANTHROPIC_API_KEY", "test");
vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
vi.stubEnv("OPENAI_API_KEY", "");

const { streamChat } = await import("./agent");
const { buildAiTools } = await import("./registry/build");
const { createArtifactSink } = await import("./artifacts/sink");
const { applyQuestionAnswers, answersTurnMessage } =
  await import("./lib/questions");

const FILE_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const ASK_ID = "toolu_ask";

const questions = {
  questions: Array.from({ length: 4 }, (_, q) => ({
    id: `q${q}`,
    prompt: `¿Qué moneda y tipo tiene la cuenta ${q} de la imagen?`,
    kind: "single",
    options: Array.from({ length: 10 }, (_, o) => ({
      value: `op_${o}`,
      label: `Opción ${o} con una etiqueta bastante larga`,
    })),
  })),
};

const imageMessage: UIMessage = {
  id: "u1",
  role: "user",
  parts: [
    {
      type: "data-attachment",
      id: FILE_ID,
      data: {
        fileId: FILE_ID,
        filename: "cuentas.png",
        mimeType: "image/png",
        size: 4,
      },
    },
    { type: "text", text: "Me ayudas a crear esas cuentas?" },
  ],
};

const sentImage: AttachmentContents = new Map([
  [FILE_ID, { kind: "file", mediaType: "image/png", base64: "iVBORw==" }],
]);
const imageNote: AttachmentContents = new Map([
  [FILE_ID, { kind: "summary", pages: null, rows: null }],
]);

/** One chat turn as the route runs it; returns the stored assistant message
 *  (JSON round trip, as ai_chat_messages keeps it). */
async function turn(
  messages: UIMessage[],
  attachments: AttachmentContents,
): Promise<UIMessage> {
  const tools = buildAiTools({
    userId: "u1",
    access: resolveAccess(["owner"]),
    artifacts: createArtifactSink(),
  });
  const result = await streamChat(messages, {
    tools,
    capabilities: "x",
    attachments,
    onAttachmentRejected: async () => undefined,
  });
  const errors: unknown[] = [];
  let saved: UIMessage | null = null;
  const stream = createUIMessageStream({
    originalMessages: messages,
    generateId: () => crypto.randomUUID(),
    execute: ({ writer }) => {
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          tools,
          onError: (error) => {
            errors.push(error);
            return "error";
          },
        }),
      );
    },
    onEnd: ({ responseMessage }) => {
      saved = JSON.parse(JSON.stringify(responseMessage));
    },
  });
  for await (const _ of readUIMessageStream({ stream })) void _;
  expect(errors).toEqual([]);
  if (!saved) throw new Error("no response message");
  return saved;
}

/** The Messages API rules a replayed history can break. */
function expectValidRequest(body: Body) {
  const { messages } = body;
  expect(messages[0]?.role).toBe("user");
  let breakpoints = 0;
  for (const [i, message] of messages.entries()) {
    expect(message.content.length, `messages.${i} is empty`).toBeGreaterThan(0);
    for (const block of message.content) {
      if (block.cache_control) breakpoints++;
      if (block.type === "text") expect(block.text).not.toBe("");
      if (block.type === "thinking") expect(block.signature).toBeTruthy();
    }
    const uses = message.content
      .filter((b) => b.type === "tool_use")
      .map((b) => b.id);
    const next = messages[i + 1];
    const results = (next?.content ?? [])
      .filter((b) => b.type === "tool_result")
      .map((b) => b.tool_use_id);
    if (message.role === "assistant") {
      // Every tool_use is answered in the very next message, results first.
      expect(results.sort()).toEqual([...uses].sort());
      const firstOther = (next?.content ?? []).findIndex(
        (b) => b.type !== "tool_result",
      );
      if (firstOther !== -1) {
        expect(
          (next?.content ?? [])
            .slice(firstOther)
            .some((b) => b.type === "tool_result"),
        ).toBe(false);
      }
    }
  }
  expect(breakpoints).toBeLessThanOrEqual(3);
  // A request that ends on tool results continues the assistant's tool
  // round: its thinking would have to come back unchanged. Replayed turns
  // carry none, so the last user message never holds a tool_result unless
  // that round started in this same request.
  const last = messages.at(-1);
  expect(last?.role).toBe("user");
}

function lastUserBlocks(body: Body | undefined): Block[] {
  const last = body?.messages.at(-1);
  if (!last || last.role !== "user") throw new Error("no trailing user");
  return last.content;
}

async function firstTurn(): Promise<UIMessage[]> {
  replies.push(
    toolReply("toolu_acc", "getAccounts", {}),
    toolReply(ASK_ID, "askQuestions", questions),
  );
  const saved = await turn([imageMessage], sentImage);
  return validateUIMessages({
    messages: JSON.parse(JSON.stringify([imageMessage, saved])),
  });
}

function answered(stored: UIMessage[]): UIMessage[] {
  const applied = applyQuestionAnswers(stored, ASK_ID, {
    answers: questions.questions.map((q) => ({ id: q.id, values: ["op_1"] })),
  });
  if (!applied.ok) throw new Error(applied.error);
  return [...applied.messages, answersTurnMessage(ASK_ID)];
}

beforeEach(() => {
  requests.length = 0;
  replies.length = 0;
});

describe("chat replay: image + tools + question card", () => {
  it("sends the image as a file on its own turn and keeps tool pairs", async () => {
    await firstTurn();
    expect(requests).toHaveLength(2);
    for (const body of requests) expectValidRequest(body);
    const first = requests[0]?.messages[0]?.content ?? [];
    expect(first.map((b) => b.type)).toEqual(["text", "image", "text"]);
  });

  it("answering the card reaches the model as a new turn", async () => {
    const stored = await firstTurn();
    requests.length = 0;
    replies.push(textReply("Listo, armo las cuentas."));
    const reply = await turn(answered(stored), imageNote);

    expect(reply.parts.some((p) => p.type === "text")).toBe(true);
    const body = requests[0];
    if (!body) throw new Error("no request");
    expectValidRequest(body);
    const last = lastUserBlocks(body);
    expect(last.some((b) => b.type === "tool_result")).toBe(false);
    const text = last.map((b) => String(b.text ?? "")).join("\n");
    expect(text).toContain("[Respuestas de la tarjeta]");
    expect(text).toContain("Opción 1 con una etiqueta bastante larga");
    // The card itself is the assistant's text, never clipped.
    const card = body.messages.at(-2);
    expect(card?.role).toBe("assistant");
    expect(JSON.stringify(card?.content)).toContain(
      "¿Qué moneda y tipo tiene la cuenta 3 de la imagen?",
    );
    const history = JSON.stringify(body.messages);
    expect(history).not.toContain('"name":"askQuestions"');
    // The earlier image goes back as a note, not as bytes.
    expect(history).not.toContain('"type":"image"');
  });

  it("a session broken by a failed answers turn recovers on the next message", async () => {
    const stored = await firstTurn();
    requests.length = 0;
    // What production stored: the answers turn, then an empty assistant
    // message from the failed call, then the user's follow-up.
    const broken: UIMessage[] = await validateUIMessages({
      messages: JSON.parse(
        JSON.stringify([
          ...answered(stored),
          { id: "empty", role: "assistant", parts: [] },
          {
            id: "u3",
            role: "user",
            parts: [{ type: "text", text: "crea las cuentas" }],
          },
        ]),
      ),
    });
    replies.push(textReply("Te propongo las cuentas."));
    await turn(broken, imageNote);

    const body = requests[0];
    if (!body) throw new Error("no request");
    expectValidRequest(body);
    const last = lastUserBlocks(body);
    expect(last.some((b) => b.type === "tool_result")).toBe(false);
    expect(JSON.stringify(last)).toContain("crea las cuentas");
  });

  it("clips earlier tool results without breaking tool_use/tool_result pairs", async () => {
    const stored = await firstTurn();
    requests.length = 0;
    replies.push(textReply("Ok."));
    await turn(
      [
        ...answered(stored),
        {
          id: "a2",
          role: "assistant",
          parts: [{ type: "text", text: "Listo." }],
        },
        { id: "u3", role: "user", parts: [{ type: "text", text: "y?" }] },
      ],
      imageNote,
    );
    const body = requests[0];
    if (!body) throw new Error("no request");
    expectValidRequest(body);
    const result = body.messages
      .flatMap((m) => m.content)
      .find((b) => b.type === "tool_result" && b.tool_use_id === "toolu_acc");
    expect(String(result?.content)).toContain("[recortado:");
  });
});
